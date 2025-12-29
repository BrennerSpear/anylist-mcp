#!/usr/bin/env npx tsx

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { config as loadEnv } from "dotenv"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
// @ts-expect-error - anylist has no type definitions
import AnyList from "anylist"

// Load credentials from ~/.claude/secrets/anylist/.env
const envPath = path.join(os.homedir(), ".claude", "secrets", "anylist", ".env")
loadEnv({ path: envPath })

const email = process.env.ANYLIST_EMAIL
const password = process.env.ANYLIST_PASSWORD

if (!email || !password) {
	console.error(`Missing credentials. Create ${envPath} with:`)
	console.error("ANYLIST_EMAIL=your@email.com")
	console.error("ANYLIST_PASSWORD=yourpassword")
	process.exit(1)
}

// Types for AnyList
interface Category {
	identifier: string
	name: string
}

interface ListItem {
	identifier: string
	name: string
	quantity?: string
	details?: string
	checked: boolean
	listId: string
	categoryMatchId?: string
	save: (isFavorite?: boolean) => Promise<void>
}

interface List {
	identifier: string
	name: string
	items: ListItem[]
	categoryGroupings: Category[]
	getItemByName: (name: string) => ListItem | undefined
	addItem: (item: ListItem, isFavorite?: boolean) => Promise<ListItem>
	removeItem: (item: ListItem, isFavorite?: boolean) => Promise<void>
	uncheckAll: () => Promise<void>
}

interface RecipeCollection {
	identifier: string
	name: string
	recipeIds: string[]
	save: () => Promise<void>
	delete: () => Promise<void>
}

// Singleton AnyList client
let anylistClient: AnyList | null = null
let isLoggedIn = false

async function getClient(): Promise<AnyList> {
	if (!anylistClient) {
		anylistClient = new AnyList({
			email,
			password,
			credentialsFile: null,
		})
	}

	if (!isLoggedIn) {
		await anylistClient.login(false)
		await anylistClient.getLists()
		isLoggedIn = true
	}

	return anylistClient
}

const server = new McpServer({
	name: "anylist-mcp",
	version: "1.0.0",
})

// List tools
server.registerTool(
	"anylist_get_lists",
	{
		title: "Get Shopping Lists",
		description: "Get all shopping lists",
		inputSchema: {},
	},
	async () => {
		const client = await getClient()
		const lists = client.lists as List[]
		const result = lists.map((l: List) => ({
			name: l.name,
			itemCount: l.items.length,
			uncheckedCount: l.items.filter((i: ListItem) => !i.checked).length,
		}))
		return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
	},
)

server.registerTool(
	"anylist_get_categories",
	{
		title: "Get Categories",
		description: "Get all categories for a shopping list",
		inputSchema: {
			list_name: z.string().describe("Name of the shopping list"),
		},
	},
	async ({ list_name }) => {
		const client = await getClient()
		const list = client.getListByName(list_name) as List | undefined
		if (!list) throw new Error(`List "${list_name}" not found`)
		const result = list.categoryGroupings.map((c: Category) => c.name)
		return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
	},
)

server.registerTool(
	"anylist_get_list_items",
	{
		title: "Get List Items",
		description: "Get all items in a shopping list",
		inputSchema: {
			list_name: z.string().describe("Name of the shopping list"),
		},
	},
	async ({ list_name }) => {
		const client = await getClient()
		const list = client.getListByName(list_name) as List | undefined
		if (!list) throw new Error(`List "${list_name}" not found`)

		const categoryById = new Map<string, string>()
		for (const cat of list.categoryGroupings) {
			categoryById.set(cat.identifier, cat.name)
		}

		const grouped: Record<string, Array<{ name: string; quantity?: string; details?: string; checked: boolean }>> = {}
		for (const item of list.items) {
			const catName = item.categoryMatchId ? categoryById.get(item.categoryMatchId) || "Uncategorized" : "Uncategorized"
			if (!grouped[catName]) grouped[catName] = []
			grouped[catName].push({
				name: item.name,
				quantity: item.quantity,
				details: item.details,
				checked: item.checked,
			})
		}
		return { content: [{ type: "text" as const, text: JSON.stringify(grouped, null, 2) }] }
	},
)

server.registerTool(
	"anylist_add_item",
	{
		title: "Add Item",
		description: "Add an item to a shopping list. Reuses existing checked-off items if found.",
		inputSchema: {
			list_name: z.string().describe("Name of the shopping list"),
			item_name: z.string().describe("Name of the item to add"),
			quantity: z.string().optional().describe("Quantity (e.g., '2', '1 lb')"),
			details: z.string().optional().describe("Additional details or notes"),
			category: z.string().optional().describe("Category name to put the item in (optional)"),
		},
	},
	async ({ list_name, item_name, quantity, details, category }) => {
		const client = await getClient()
		const list = client.getListByName(list_name) as List | undefined
		if (!list) throw new Error(`List "${list_name}" not found`)

		let categoryId: string | undefined
		if (category) {
			const cat = list.categoryGroupings.find((c: Category) => c.name.toLowerCase() === category.toLowerCase())
			if (!cat) {
				const available = list.categoryGroupings.map((c: Category) => c.name).join(", ")
				throw new Error(`Category "${category}" not found. Available: ${available}`)
			}
			categoryId = cat.identifier
		}

		const existingItem = list.getItemByName(item_name)
		if (existingItem && existingItem.checked) {
			existingItem.checked = false
			if (categoryId) existingItem.categoryMatchId = categoryId
			if (quantity) existingItem.quantity = quantity
			if (details) existingItem.details = details
			await existingItem.save()
			return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, reused: true, item: item_name, category }) }] }
		}

		const newItem = client.createItem({
			name: item_name,
			quantity,
			details,
			...(categoryId && { categoryMatchId: categoryId }),
		}) as ListItem
		await list.addItem(newItem)
		return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, reused: false, item: item_name, category }) }] }
	},
)

server.registerTool(
	"anylist_check_item",
	{
		title: "Check/Uncheck Item",
		description: "Check or uncheck an item in a shopping list",
		inputSchema: {
			list_name: z.string().describe("Name of the shopping list"),
			item_name: z.string().describe("Name of the item"),
			checked: z.boolean().describe("Whether the item should be checked (true) or unchecked (false)"),
		},
	},
	async ({ list_name, item_name, checked }) => {
		const client = await getClient()
		const list = client.getListByName(list_name) as List | undefined
		if (!list) throw new Error(`List "${list_name}" not found`)

		const item = list.getItemByName(item_name)
		if (!item) throw new Error(`Item "${item_name}" not found in list "${list_name}"`)

		item.checked = checked
		await item.save()
		return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, item: item_name, checked }) }] }
	},
)

server.registerTool(
	"anylist_update_item",
	{
		title: "Update Item",
		description: "Update an item's quantity or details",
		inputSchema: {
			list_name: z.string().describe("Name of the shopping list"),
			item_name: z.string().describe("Name of the item to update"),
			quantity: z.string().optional().describe("New quantity"),
			details: z.string().optional().describe("New details/notes"),
		},
	},
	async ({ list_name, item_name, quantity, details }) => {
		const client = await getClient()
		const list = client.getListByName(list_name) as List | undefined
		if (!list) throw new Error(`List "${list_name}" not found`)

		const item = list.getItemByName(item_name)
		if (!item) throw new Error(`Item "${item_name}" not found in list "${list_name}"`)

		if (quantity !== undefined) item.quantity = quantity
		if (details !== undefined) item.details = details
		await item.save()
		return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, item: item_name }) }] }
	},
)

server.registerTool(
	"anylist_remove_item",
	{
		title: "Remove Item",
		description: "Remove an item from a shopping list",
		inputSchema: {
			list_name: z.string().describe("Name of the shopping list"),
			item_name: z.string().describe("Name of the item to remove"),
		},
	},
	async ({ list_name, item_name }) => {
		const client = await getClient()
		const list = client.getListByName(list_name) as List | undefined
		if (!list) throw new Error(`List "${list_name}" not found`)

		const item = list.getItemByName(item_name)
		if (!item) throw new Error(`Item "${item_name}" not found in list "${list_name}"`)

		await list.removeItem(item)
		return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, removed: item_name }) }] }
	},
)

server.registerTool(
	"anylist_uncheck_all",
	{
		title: "Uncheck All Items",
		description: "Uncheck all items in a shopping list",
		inputSchema: {
			list_name: z.string().describe("Name of the shopping list"),
		},
	},
	async ({ list_name }) => {
		const client = await getClient()
		const list = client.getListByName(list_name) as List | undefined
		if (!list) throw new Error(`List "${list_name}" not found`)

		await list.uncheckAll()
		return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, list: list_name }) }] }
	},
)

// Recipe collection tools
server.registerTool(
	"anylist_get_recipe_collections",
	{
		title: "Get Recipe Collections",
		description: "Get all recipe collections",
		inputSchema: {},
	},
	async () => {
		const client = await getClient()
		await client.getRecipes()
		const userData = await client._getUserData(false)
		const collections = userData.recipeDataResponse.recipeCollections || []
		const result = collections.map((c: { name: string; recipeIds: string[] }) => ({
			name: c.name,
			recipeCount: c.recipeIds?.length || 0,
		}))
		return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] }
	},
)

server.registerTool(
	"anylist_create_recipe_collection",
	{
		title: "Create Recipe Collection",
		description: "Create a new recipe collection",
		inputSchema: {
			name: z.string().describe("Name for the new collection"),
		},
	},
	async ({ name }) => {
		const client = await getClient()
		await client.getRecipes()
		const collection = client.createRecipeCollection({ name }) as RecipeCollection
		await collection.save()
		return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, created: name }) }] }
	},
)

server.registerTool(
	"anylist_delete_recipe_collection",
	{
		title: "Delete Recipe Collection",
		description: "Delete a recipe collection",
		inputSchema: {
			name: z.string().describe("Name of the collection to delete"),
		},
	},
	async ({ name }) => {
		const client = await getClient()
		await client.getRecipes()
		const userData = await client._getUserData(false)
		const collections = userData.recipeDataResponse.recipeCollections || []
		const collectionData = collections.find((c: { name: string }) => c.name === name)
		if (!collectionData) throw new Error(`Recipe collection "${name}" not found`)

		const collection = client.createRecipeCollection(collectionData) as RecipeCollection
		await collection.delete()
		return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: name }) }] }
	},
)

async function main() {
	const transport = new StdioServerTransport()
	await server.connect(transport)
}

main().catch((error) => {
	console.error("Fatal error:", error)
	process.exit(1)
})

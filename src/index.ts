#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { config } from "dotenv"
import path from "path"
import os from "os"
// @ts-expect-error - anylist has no type definitions
import AnyList from "anylist"

// Load credentials from ~/.claude/secrets/anylist/.env
const envPath = path.join(os.homedir(), ".claude", "secrets", "anylist", ".env")
config({ path: envPath })

const email = process.env.ANYLIST_EMAIL
const password = process.env.ANYLIST_PASSWORD

if (!email || !password) {
  console.error(`Missing credentials. Create ${envPath} with:`)
  console.error("ANYLIST_EMAIL=your@email.com")
  console.error("ANYLIST_PASSWORD=yourpassword")
  process.exit(1)
}

// Singleton AnyList client
let anylistClient: AnyList | null = null
let isLoggedIn = false

async function getClient(): Promise<AnyList> {
  if (!anylistClient) {
    anylistClient = new AnyList({
      email,
      password,
      credentialsFile: null, // Don't persist credentials to disk
    })
  }

  if (!isLoggedIn) {
    await anylistClient.login(false) // false = don't connect websocket
    await anylistClient.getLists()
    isLoggedIn = true
  }

  return anylistClient
}

// Tool definitions
const tools = [
  // List tools
  {
    name: "anylist_get_lists",
    description: "Get all shopping lists",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "anylist_get_categories",
    description: "Get all categories for a shopping list",
    inputSchema: {
      type: "object" as const,
      properties: {
        list_name: {
          type: "string",
          description: "Name of the shopping list",
        },
      },
      required: ["list_name"],
    },
  },
  {
    name: "anylist_get_list_items",
    description: "Get all items in a shopping list",
    inputSchema: {
      type: "object" as const,
      properties: {
        list_name: {
          type: "string",
          description: "Name of the shopping list",
        },
      },
      required: ["list_name"],
    },
  },
  {
    name: "anylist_add_item",
    description:
      "Add an item to a shopping list. Reuses existing checked-off items if found.",
    inputSchema: {
      type: "object" as const,
      properties: {
        list_name: {
          type: "string",
          description: "Name of the shopping list",
        },
        item_name: {
          type: "string",
          description: "Name of the item to add",
        },
        quantity: {
          type: "string",
          description: "Quantity (e.g., '2', '1 lb')",
        },
        details: {
          type: "string",
          description: "Additional details or notes",
        },
        category: {
          type: "string",
          description: "Category name to put the item in (optional)",
        },
      },
      required: ["list_name", "item_name"],
    },
  },
  {
    name: "anylist_check_item",
    description: "Check or uncheck an item in a shopping list",
    inputSchema: {
      type: "object" as const,
      properties: {
        list_name: {
          type: "string",
          description: "Name of the shopping list",
        },
        item_name: {
          type: "string",
          description: "Name of the item",
        },
        checked: {
          type: "boolean",
          description: "Whether the item should be checked (true) or unchecked (false)",
        },
      },
      required: ["list_name", "item_name", "checked"],
    },
  },
  {
    name: "anylist_update_item",
    description: "Update an item's quantity or details",
    inputSchema: {
      type: "object" as const,
      properties: {
        list_name: {
          type: "string",
          description: "Name of the shopping list",
        },
        item_name: {
          type: "string",
          description: "Name of the item to update",
        },
        quantity: {
          type: "string",
          description: "New quantity",
        },
        details: {
          type: "string",
          description: "New details/notes",
        },
      },
      required: ["list_name", "item_name"],
    },
  },
  {
    name: "anylist_remove_item",
    description: "Remove an item from a shopping list",
    inputSchema: {
      type: "object" as const,
      properties: {
        list_name: {
          type: "string",
          description: "Name of the shopping list",
        },
        item_name: {
          type: "string",
          description: "Name of the item to remove",
        },
      },
      required: ["list_name", "item_name"],
    },
  },
  {
    name: "anylist_uncheck_all",
    description: "Uncheck all items in a shopping list",
    inputSchema: {
      type: "object" as const,
      properties: {
        list_name: {
          type: "string",
          description: "Name of the shopping list",
        },
      },
      required: ["list_name"],
    },
  },
  // Recipe collection tools
  {
    name: "anylist_get_recipe_collections",
    description: "Get all recipe collections",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "anylist_create_recipe_collection",
    description: "Create a new recipe collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name for the new collection",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "anylist_delete_recipe_collection",
    description: "Delete a recipe collection",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the collection to delete",
        },
      },
      required: ["name"],
    },
  },
]

// Tool handlers
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

async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const client = await getClient()

  switch (name) {
    case "anylist_get_lists": {
      const lists = client.lists as List[]
      return JSON.stringify(
        lists.map((l: List) => ({
          name: l.name,
          itemCount: l.items.length,
          uncheckedCount: l.items.filter((i: ListItem) => !i.checked).length,
        })),
        null,
        2
      )
    }

    case "anylist_get_categories": {
      const listName = args.list_name as string
      const list = client.getListByName(listName) as List | undefined
      if (!list) {
        throw new Error(`List "${listName}" not found`)
      }
      return JSON.stringify(
        list.categoryGroupings.map((c: Category) => c.name),
        null,
        2
      )
    }

    case "anylist_get_list_items": {
      const listName = args.list_name as string
      const list = client.getListByName(listName) as List | undefined
      if (!list) {
        throw new Error(`List "${listName}" not found`)
      }
      // Build category lookup
      const categoryById = new Map<string, string>()
      for (const cat of list.categoryGroupings) {
        categoryById.set(cat.identifier, cat.name)
      }
      // Group items by category
      const grouped: Record<string, Array<{
        name: string
        quantity?: string
        details?: string
        checked: boolean
      }>> = {}
      for (const item of list.items) {
        const catName = item.categoryMatchId
          ? categoryById.get(item.categoryMatchId) || "Uncategorized"
          : "Uncategorized"
        if (!grouped[catName]) {
          grouped[catName] = []
        }
        grouped[catName].push({
          name: item.name,
          quantity: item.quantity,
          details: item.details,
          checked: item.checked,
        })
      }
      return JSON.stringify(grouped, null, 2)
    }

    case "anylist_add_item": {
      const listName = args.list_name as string
      const itemName = args.item_name as string
      const quantity = args.quantity as string | undefined
      const details = args.details as string | undefined
      const categoryName = args.category as string | undefined

      const list = client.getListByName(listName) as List | undefined
      if (!list) {
        throw new Error(`List "${listName}" not found`)
      }

      // Find category by name if provided
      let categoryId: string | undefined
      if (categoryName) {
        const category = list.categoryGroupings.find(
          (c: Category) => c.name.toLowerCase() === categoryName.toLowerCase()
        )
        if (!category) {
          const available = list.categoryGroupings.map((c: Category) => c.name).join(", ")
          throw new Error(`Category "${categoryName}" not found. Available: ${available}`)
        }
        categoryId = category.identifier
      }

      // Check for existing item to reuse (as recommended by anylist package)
      const existingItem = list.getItemByName(itemName)
      if (existingItem && existingItem.checked) {
        // Reuse existing checked item
        existingItem.checked = false
        if (categoryId) existingItem.categoryMatchId = categoryId
        if (quantity) existingItem.quantity = quantity
        if (details) existingItem.details = details
        await existingItem.save()
        return JSON.stringify({ success: true, reused: true, item: itemName, category: categoryName })
      }

      // Create new item
      const newItem = client.createItem({
        name: itemName,
        quantity,
        details,
        ...(categoryId && { categoryMatchId: categoryId }),
      }) as ListItem
      await list.addItem(newItem)
      return JSON.stringify({ success: true, reused: false, item: itemName, category: categoryName })
    }

    case "anylist_check_item": {
      const listName = args.list_name as string
      const itemName = args.item_name as string
      const checked = args.checked as boolean

      const list = client.getListByName(listName) as List | undefined
      if (!list) {
        throw new Error(`List "${listName}" not found`)
      }

      const item = list.getItemByName(itemName)
      if (!item) {
        throw new Error(`Item "${itemName}" not found in list "${listName}"`)
      }

      item.checked = checked
      await item.save()
      return JSON.stringify({ success: true, item: itemName, checked })
    }

    case "anylist_update_item": {
      const listName = args.list_name as string
      const itemName = args.item_name as string
      const quantity = args.quantity as string | undefined
      const details = args.details as string | undefined

      const list = client.getListByName(listName) as List | undefined
      if (!list) {
        throw new Error(`List "${listName}" not found`)
      }

      const item = list.getItemByName(itemName)
      if (!item) {
        throw new Error(`Item "${itemName}" not found in list "${listName}"`)
      }

      if (quantity !== undefined) item.quantity = quantity
      if (details !== undefined) item.details = details
      await item.save()
      return JSON.stringify({ success: true, item: itemName })
    }

    case "anylist_remove_item": {
      const listName = args.list_name as string
      const itemName = args.item_name as string

      const list = client.getListByName(listName) as List | undefined
      if (!list) {
        throw new Error(`List "${listName}" not found`)
      }

      const item = list.getItemByName(itemName)
      if (!item) {
        throw new Error(`Item "${itemName}" not found in list "${listName}"`)
      }

      await list.removeItem(item)
      return JSON.stringify({ success: true, removed: itemName })
    }

    case "anylist_uncheck_all": {
      const listName = args.list_name as string

      const list = client.getListByName(listName) as List | undefined
      if (!list) {
        throw new Error(`List "${listName}" not found`)
      }

      await list.uncheckAll()
      return JSON.stringify({ success: true, list: listName })
    }

    case "anylist_get_recipe_collections": {
      await client.getRecipes() // This loads recipe collections too
      // Recipe collections are not directly exposed, need to access via internal data
      const userData = await client._getUserData(false)
      const collections = userData.recipeDataResponse.recipeCollections || []
      return JSON.stringify(
        collections.map((c: { name: string; recipeIds: string[] }) => ({
          name: c.name,
          recipeCount: c.recipeIds?.length || 0,
        })),
        null,
        2
      )
    }

    case "anylist_create_recipe_collection": {
      const name = args.name as string
      await client.getRecipes() // Ensure recipeDataId is loaded
      const collection = client.createRecipeCollection({ name }) as RecipeCollection
      await collection.save()
      return JSON.stringify({ success: true, created: name })
    }

    case "anylist_delete_recipe_collection": {
      const name = args.name as string
      await client.getRecipes()
      const userData = await client._getUserData(false)
      const collections = userData.recipeDataResponse.recipeCollections || []
      const collectionData = collections.find(
        (c: { name: string }) => c.name === name
      )
      if (!collectionData) {
        throw new Error(`Recipe collection "${name}" not found`)
      }

      const collection = client.createRecipeCollection(collectionData) as RecipeCollection
      await collection.delete()
      return JSON.stringify({ success: true, deleted: name })
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// Create and run server
const server = new Server(
  {
    name: "anylist-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await handleTool(
      request.params.name,
      (request.params.arguments as Record<string, unknown>) || {}
    )
    return {
      content: [{ type: "text", text: result }],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    }
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("AnyList MCP server running")
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})

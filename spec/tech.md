# AnyList MCP Technical Specification

## Package Analysis

The `anylist` package (v0.8.5) is an unofficial reverse-engineered wrapper for AnyList's API. It provides functionality for managing shopping lists, recipes, recipe collections, and meal planning calendar events.

## Package Capabilities

### 1. Authentication & Session Management
- **Login** with email/password credentials
- **Persistent credentials storage** (encrypted with AES-256)
- **WebSocket connection** for real-time list updates
- **Token refresh** handling

### 2. Shopping Lists (`List` class)

| Method | Description |
|--------|-------------|
| `getLists()` | Fetch all shopping lists |
| `getListById(id)` | Get list by identifier |
| `getListByName(name)` | Get list by name |
| `getFavoriteItemsByListId(id)` | Get favorite items for a list |
| `getRecentItemsByListId(id)` | Get recently added items for a list |

#### List Operations
| Method | Description |
|--------|-------------|
| `list.addItem(item)` | Add an item to a list |
| `list.removeItem(item)` | Remove an item from a list |
| `list.uncheckAll()` | Uncheck all items in a list |
| `list.getItemById(id)` | Find item by ID |
| `list.getItemByName(name)` | Find item by name |

**Note:** The package does NOT currently support creating, deleting, or renaming lists.

### 3. Items (`Item` class)

| Property | Type | Editable |
|----------|------|----------|
| `identifier` | string | No |
| `listId` | string | No (only settable once) |
| `name` | string | Yes |
| `quantity` | string | Yes |
| `details` | string | Yes |
| `checked` | boolean | Yes |
| `categoryMatchId` | string | Yes |
| `manualSortIndex` | number | Yes |
| `userId` | string | No |

| Method | Description |
|--------|-------------|
| `createItem({name, ...})` | Factory to create a new item |
| `item.save()` | Save item changes to API |

### 4. Recipes (`Recipe` class)

| Property | Type |
|----------|------|
| `identifier` | string |
| `name` | string |
| `note` | string |
| `sourceName` | string |
| `sourceUrl` | string |
| `ingredients` | Ingredient[] |
| `preparationSteps` | string[] |
| `photoIds` | string[] |
| `photoUrls` | string[] |
| `scaleFactor` | number |
| `rating` | number (1-5) |
| `nutritionalInfo` | string |
| `cookTime` | number (seconds) |
| `prepTime` | number (seconds) |
| `servings` | string |

| Method | Description |
|--------|-------------|
| `getRecipes()` | Fetch all recipes |
| `createRecipe({...})` | Factory to create a new recipe |
| `recipe.save()` | Save recipe to API |
| `recipe.delete()` | Delete recipe from API |

### 5. Recipe Collections (`RecipeCollection` class)

| Property | Type |
|----------|------|
| `identifier` | string |
| `name` | string |
| `recipeIds` | string[] |

| Method | Description |
|--------|-------------|
| `createRecipeCollection({name})` | Factory to create collection |
| `collection.save()` | Save new collection |
| `collection.delete()` | Delete collection |
| `collection.addRecipe(recipeId)` | Add recipe to collection |
| `collection.removeRecipe(recipeId)` | Remove recipe from collection |

### 6. Meal Planning Calendar (`MealPlanningCalendarEvent` class)

| Property | Type |
|----------|------|
| `identifier` | string |
| `date` | Date |
| `title` | string |
| `details` | string |
| `labelId` | string |
| `recipeId` | string |
| `recipeScaleFactor` | number |

| Method | Description |
|--------|-------------|
| `getMealPlanningCalendarEvents()` | Fetch all calendar events |
| `createEvent({title, date, ...})` | Factory to create event |
| `event.save()` | Save event to API |
| `event.delete()` | Delete event from API |

### 7. Ingredients (`Ingredient` class)

| Property | Type |
|----------|------|
| `rawIngredient` | string |
| `name` | string |
| `quantity` | string |
| `note` | string |

---

## Proposed MCP Tools

### Shopping Lists
| Tool | Description | Parameters |
|------|-------------|------------|
| `anylist_get_lists` | Get all shopping lists | - |
| `anylist_get_list_items` | Get all items in a list | `list_name: string` |
| `anylist_add_item` | Add an item to a shopping list | `list_name: string, item_name: string, quantity?: string, details?: string` |
| `anylist_check_item` | Check/uncheck an item | `list_name: string, item_name: string, checked: boolean` |
| `anylist_update_item` | Update item properties | `list_name: string, item_name: string, quantity?: string, details?: string` |
| `anylist_remove_item` | Remove an item from a list | `list_name: string, item_name: string` |
| `anylist_uncheck_all` | Uncheck all items in a list | `list_name: string` |

### Recipe Collections
| Tool | Description | Parameters |
|------|-------------|------------|
| `anylist_get_recipe_collections` | Get all recipe collections | - |
| `anylist_create_recipe_collection` | Create a new collection | `name: string` |
| `anylist_delete_recipe_collection` | Delete a collection | `name: string` |

---

## Authentication Strategy

Credentials stored in `~/.claude/secrets/anylist/.env`:
```env
ANYLIST_EMAIL=you@example.com
ANYLIST_PASSWORD=yourpassword
```

The MCP server:
1. Loads credentials from `~/.claude/secrets/anylist/.env` using dotenv
2. Maintains a singleton AnyList instance initialized on first tool use
3. Disables anylist's built-in credentials file (`credentialsFile: null`)

## Limitations

1. **Cannot create/delete/rename lists** - Package limitation
2. **No photo upload support** - Package only reads photo URLs
3. **No recipe editing** - Only create and delete supported
4. **WebSocket disabled** - MCP tools are stateless, so real-time updates are not practical

---

## Implementation Notes

1. All tools will be implemented as async operations
2. Error handling will return descriptive error messages
3. Item reuse pattern: When adding items, check if a checked-off item with the same name exists and reuse it
4. All datetime inputs should use ISO 8601 format (`YYYY-MM-DD`)

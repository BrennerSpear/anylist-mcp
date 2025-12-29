# AnyList MCP

MCP server for managing AnyList shopping lists and recipe collections.

## Setup

### 1. Build the server

```bash
pnpm install
pnpm build
```

### 2. Add your credentials

Create `~/.claude/secrets/anylist/.env`:

```env
ANYLIST_EMAIL=your@email.com
ANYLIST_PASSWORD=yourpassword
```

### 3. Add to Claude Code

Add to your `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "anylist": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/anylist-mcp/dist/index.js"]
    }
  }
}
```

## Available Tools

### Shopping Lists

| Tool | Description |
|------|-------------|
| `anylist_get_lists` | Get all shopping lists |
| `anylist_get_categories` | Get categories for a list |
| `anylist_get_list_items` | Get items in a list (includes category) |
| `anylist_add_item` | Add an item with category (reuses checked items) |
| `anylist_check_item` | Check/uncheck an item |
| `anylist_update_item` | Update item quantity/details |
| `anylist_remove_item` | Remove an item |
| `anylist_uncheck_all` | Uncheck all items in a list |

### Recipe Collections

| Tool | Description |
|------|-------------|
| `anylist_get_recipe_collections` | Get all recipe collections |
| `anylist_create_recipe_collection` | Create a new collection |
| `anylist_delete_recipe_collection` | Delete a collection |

## Limitations

- Cannot create/delete/rename lists (AnyList API limitation)
- Recipe collections only - full recipe management not implemented

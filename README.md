# SQL DBMap

**Generate database ER diagrams from your SQL files, inside VS Code.**

Sister project of [CDK Stack Map](https://github.com/marabunta-labs/cdk-stackmap): same sidebar + interactive webview, but the input is plain DDL instead of a CDK assembly.

## Features

* **Dialects:** PostgreSQL, MySQL/MariaDB, SQL Server (T-SQL) and Oracle. A tolerant built-in reader understands `CREATE TABLE` and `ALTER TABLE ... ADD` (columns, primary keys, unique and foreign keys, inline or table-level). Anything else is skipped, never an error.
* **ER diagram:** each table is a box with its columns, types and `PK` / `FK` / `PFK` badges. Relations use crow's-foot notation (bar = one, fork = many, circle = optional, bar on both ends = one-to-one).
* **Schemas:** tables are colored per schema; toggle schemas on and off from the panel.
* **Tables not defined in your SQL** (e.g. `auth.users` in Supabase) appear as dashed *external* tables.
* **Click a table, a column or a relation line** to highlight them together: click a key column and every relation (and the matching columns in the other tables) lights up; click a relation and its two columns light up. A side panel shows the details.
* **Physics (optional button):** dragging a table pulls the tables linked to it and tables bump into each other instead of overlapping.
* **Minimap** (click or drag it to navigate), search, keys-only mode, zoom/pan, re-layout.
* **Export:** PNG, SVG, Mermaid `erDiagram` (.mmd) and JSON. Only what is currently visible is exported.

## How to use

1. Open the **SQL DBMap** view in the Activity Bar and pick the folder with your `.sql` files (all `.sql` files below it are read together, so `ALTER TABLE` in one file can reference tables from another).
2. Press **Visualize**.

## Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `sql-dbmap.columnDisplay` | `all` | `all` columns, or only `keys` (primary/foreign key columns). |

## Limits (v0.1)

* DDL only: views, `CREATE INDEX`, `DROP`, `ALTER ... DROP/ALTER COLUMN` and procedural code are ignored, so a migration history that drops columns will still show them.
* `CREATE TABLE ... AS SELECT` and `LIKE` tables have no columns here.

## Development

```
npm install
npm test           # parser tests (node:test)
npm run compile    # type-check + lint + bundle
# F5 in VS Code runs the extension; samples/shop.sql is a demo
```

Created by **Marabunta Labs**.

import { ErColumn, ErModel, ErRelation, ErTable } from '../model/models';

/**
 * Tolerant, dependency-free reader for the DDL subset that matters for an ER diagram
 * (CREATE TABLE / ALTER TABLE ... ADD) in PostgreSQL, MySQL/MariaDB, T-SQL and Oracle.
 * Anything it does not understand is skipped rather than reported as an error.
 */

export interface SqlSource {
    path: string;
    sql: string;
}

interface RefTarget { schema: string; table: string; }

interface RawForeignKey {
    name?: string;
    columns: string[];
    ref: RefTarget;
    refColumns: string[];
}

interface RawTable {
    schema: string;
    name: string;
    columns: ErColumn[];
    primaryKey: string[];
    uniques: string[][];
    foreignKeys: RawForeignKey[];
    file?: string;
}

const IDENT = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[\\w$#@]+)';
const QNAME = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`;

const unquote = (id: string) => id.replace(/^["`[]|["`\]]$/g, '');

/** `db.schema.table` -> { schema, table }: only the last two parts matter. */
function parseQName(text: string): RefTarget {
    const parts = (text.match(new RegExp(IDENT, 'g')) ?? []).map(unquote);
    return { table: parts[parts.length - 1] ?? '', schema: parts.length > 1 ? parts[parts.length - 2] : '' };
}

function parseColumnList(text: string): string[] {
    return splitTopLevel(text, ',')
        .map(item => new RegExp(`^\\s*(${IDENT})`).exec(item)?.[1])
        .filter((id): id is string => !!id)
        .map(unquote);
}

/** Copies a quoted run (string, identifier, dollar-quoted body) starting at `i`; returns the index after it. */
function skipQuoted(s: string, i: number): number {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') {
        let j = i + 1;
        while (j < s.length) {
            if (s[j] === c) {
                if (s[j + 1] === c) { j += 2; continue; }
                return j + 1;
            }
            j++;
        }
        return s.length;
    }
    if (c === '$') {
        const tag = /^\$[A-Za-z_]*\$/.exec(s.slice(i, i + 64))?.[0];
        if (tag) {
            const end = s.indexOf(tag, i + tag.length);
            return end === -1 ? s.length : end + tag.length;
        }
    }
    return i;
}

/** Removes comments and splits on `;` plus the batch separators `GO` (T-SQL) and `/` (Oracle) on their own line. */
export function splitStatements(sql: string): string[] {
    const out: string[] = [];
    const batchLine = /[ \t]*(?:GO|\/)[ \t]*(?=\r?\n|$)/iy;
    let cur = '';
    const flush = () => {
        const text = cur.trim();
        if (text) { out.push(text); }
        cur = '';
    };
    let i = 0;
    while (i < sql.length) {
        const atLineStart = i === 0 || sql[i - 1] === '\n';
        if (atLineStart) {
            batchLine.lastIndex = i;
            const m = batchLine.exec(sql);
            if (m) { flush(); i += m[0].length; continue; }
            if (/^[ \t]*#/.test(sql.slice(i, i + 80))) {
                while (i < sql.length && sql[i] !== '\n') { i++; }
                continue;
            }
        }
        const c = sql[i];
        if (c === '-' && sql[i + 1] === '-') {
            while (i < sql.length && sql[i] !== '\n') { i++; }
        } else if (c === '/' && sql[i + 1] === '*') {
            const end = sql.indexOf('*/', i + 2);
            i = end === -1 ? sql.length : end + 2;
            cur += ' ';
        } else if (c === ';') {
            flush();
            i++;
        } else {
            const next = skipQuoted(sql, i);
            if (next > i) { cur += sql.slice(i, next); i = next; } else { cur += c; i++; }
        }
    }
    flush();
    return out;
}

/** Splits on `sep` at parenthesis depth 0, ignoring quoted text. */
function splitTopLevel(text: string, sep: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    let i = 0;
    while (i < text.length) {
        const next = skipQuoted(text, i);
        if (next > i) { i = next; continue; }
        const c = text[i];
        if (c === '(') { depth++; }
        else if (c === ')') { depth--; }
        else if (c === sep && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
        i++;
    }
    parts.push(text.slice(start));
    return parts.map(p => p.trim()).filter(p => p.length > 0);
}

/** Text between the parenthesis that opens at `openIdx` and its match, or undefined when unbalanced. */
function balancedBody(text: string, openIdx: number): string | undefined {
    let depth = 0;
    let i = openIdx;
    while (i < text.length) {
        const next = skipQuoted(text, i);
        if (next > i) { i = next; continue; }
        if (text[i] === '(') { depth++; }
        else if (text[i] === ')' && --depth === 0) { return text.slice(openIdx + 1, i); }
        i++;
    }
    return undefined;
}

const CREATE_TABLE = new RegExp(
    `^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:(?:GLOBAL|LOCAL|TEMP|TEMPORARY|UNLOGGED|EXTERNAL|VOLATILE|TRANSIENT)\\s+)*TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QNAME})\\s*\\(`, 'i');
const ALTER_TABLE = new RegExp(`^ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:IF\\s+EXISTS\\s+)?(${QNAME})\\s+([\\s\\S]*)$`, 'i');

const CONSTRAINT = new RegExp(
    `^(?:CONSTRAINT\\s+(${IDENT})\\s+)?(PRIMARY\\s+KEY|FOREIGN\\s+KEY|UNIQUE|CHECK|EXCLUDE|FULLTEXT|SPATIAL|INDEX|KEY)\\b(?:\\s+(?:KEY|INDEX))?` +
    `((?:\\s+[\\w"\`\\[\\]$.]+){0,2}\\s*\\([\\s\\S]*)$`, 'i');
const TYPE_WORDS = /^(?:INT|INTEGER|BIGINT|SMALLINT|TINYINT|MEDIUMINT|VARCHAR2?|NVARCHAR|CHAR|NCHAR|NUMBER|NUMERIC|DECIMAL|FLOAT|DOUBLE|REAL|TEXT|BLOB|BINARY|VARBINARY|DATE|DATETIME|TIMESTAMP|TIME|BOOLEAN|BOOL|BIT|UUID|JSONB?)$/i;

const TYPE_STOP = new Set([
    'NOT', 'NULL', 'DEFAULT', 'PRIMARY', 'REFERENCES', 'UNIQUE', 'CHECK', 'CONSTRAINT', 'GENERATED', 'AUTO_INCREMENT',
    'AUTOINCREMENT', 'IDENTITY', 'COLLATE', 'COMMENT', 'ON', 'AS', 'ENCODE', 'KEY', 'VISIBLE', 'INVISIBLE', 'ENABLE', 'DISABLE'
]);

/** Everything up to the first constraint keyword: `VARCHAR(255)`, `TIMESTAMP WITH TIME ZONE`, `ENUM('a','b')`... */
function extractType(rest: string): string {
    const tokens = rest.match(/"[^"]*"|`[^`]*`|\s+|\(|\)|[^\s()]+/g) ?? [];
    let depth = 0;
    let type = '';
    for (const token of tokens) {
        if (token === '(') { depth++; }
        else if (token === ')') { depth--; }
        else if (depth === 0 && TYPE_STOP.has(token.toUpperCase())) { break; }
        type += token;
    }
    return type.replace(/\s+/g, ' ').replace(/\s*\(\s*/g, '(').replace(/(^|\s)\[(\w+)\]/g, '$1$2').trim();
}

function parseColumn(def: string, table: RawTable): void {
    const m = new RegExp(`^(${IDENT})\\s*([\\s\\S]*)$`).exec(def);
    if (!m) { return; }
    const name = unquote(m[1]);
    const typed = m[2].replace(/\bCHARACTER\s+SET\s+\w+/gi, '').replace(/\bCHARSET\s*=?\s*\w+/gi, '');
    // Literals must not be mistaken for constraint words (DEFAULT 'not null')
    const rest = typed.replace(/'(?:[^']|'')*'/g, "''");

    const primaryKey = /\bPRIMARY\s+KEY\b/i.test(rest);
    const column: ErColumn = {
        name,
        type: extractType(typed),
        primaryKey,
        foreignKey: false,
        unique: /\bUNIQUE\b/i.test(rest),
        nullable: !primaryKey && !/\bNOT\s+NULL\b/i.test(rest)
    };
    table.columns = table.columns.filter(c => c.name !== name).concat(column);
    if (primaryKey) { table.primaryKey = [name]; }
    const ref = new RegExp(`\\bREFERENCES\\s+(${QNAME})\\s*(?:\\(([^)]*)\\))?`, 'i').exec(rest);
    if (ref) {
        table.foreignKeys.push({ columns: [name], ref: parseQName(ref[1]), refColumns: ref[2] ? parseColumnList(ref[2]) : [] });
    }
}

/** Applies a table-level constraint. Returns false when the item is not a constraint (i.e. it is a column). */
function parseConstraint(item: string, table: RawTable): boolean {
    const m = CONSTRAINT.exec(item);
    if (!m) { return false; }
    const kind = m[2].toUpperCase().replace(/\s+/g, ' ');
    const body = m[3];
    if ((kind === 'KEY' || kind === 'INDEX') && !m[1]) {
        // `key int(11)` is a column named "key", not a MySQL index
        const second = /^\s+([\w"`[\]$.]+)/.exec(body)?.[1];
        if (second && TYPE_WORDS.test(second)) { return false; }
    }
    if (kind === 'PRIMARY KEY') {
        table.primaryKey = parseColumnList(/\(([^)]*)\)/.exec(body)?.[1] ?? '');
    } else if (kind === 'UNIQUE') {
        const cols = parseColumnList(/\(([^)]*)\)/.exec(body)?.[1] ?? '');
        if (cols.length > 0) { table.uniques.push(cols); }
    } else if (kind === 'FOREIGN KEY') {
        const fk = new RegExp(`\\(([^)]*)\\)\\s*REFERENCES\\s+(${QNAME})\\s*(?:\\(([^)]*)\\))?`, 'i').exec(body);
        if (fk) {
            table.foreignKeys.push({
                name: m[1] ? unquote(m[1]) : undefined,
                columns: parseColumnList(fk[1]),
                ref: parseQName(fk[2]),
                refColumns: fk[3] ? parseColumnList(fk[3]) : []
            });
        }
    }
    return true;
}

function parseItem(item: string, table: RawTable): void {
    if (/^LIKE\s/i.test(item) || /^PERIOD\s/i.test(item)) { return; }
    if (!parseConstraint(item, table)) { parseColumn(item, table); }
}

const newTable = (name: RefTarget, file: string): RawTable =>
    ({ schema: name.schema, name: name.table, columns: [], primaryKey: [], uniques: [], foreignKeys: [], file });

const tableKey = (schema: string, name: string) => `${schema}.${name}`.toLowerCase();

/** Parses the given SQL sources into a single model. ALTER TABLE statements are applied once every table is known. */
export function parseSql(sources: SqlSource[]): ErModel {
    const tables = new Map<string, RawTable>();
    const alters: { target: RefTarget; actions: string[] }[] = [];

    for (const { path, sql } of sources) {
        for (const statement of splitStatements(sql)) {
            const create = CREATE_TABLE.exec(statement);
            if (create) {
                const body = balancedBody(statement, create[0].length - 1);
                if (body === undefined) { continue; }
                const name = parseQName(create[1]);
                const table = newTable(name, path);
                splitTopLevel(body, ',').forEach(item => parseItem(item, table));
                tables.set(tableKey(table.schema, table.name), table);
                continue;
            }
            const alter = ALTER_TABLE.exec(statement);
            if (alter) {
                const actions = splitTopLevel(alter[2].replace(/^WITH\s+(?:NO)?CHECK\s+/i, ''), ',');
                alters.push({ target: parseQName(alter[1]), actions });
            }
        }
    }

    for (const { target, actions } of alters) {
        const table = tables.get(tableKey(target.schema, target.table));
        if (!table) { continue; }
        for (const action of actions) {
            const add = /^ADD\s+(?:COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?)?([\s\S]+)$/i.exec(action);
            if (!add) { continue; }
            const body = add[1].trim();
            // Oracle: ADD (col type, col type, CONSTRAINT ...)
            const items = body.startsWith('(') ? splitTopLevel(balancedBody(body, 0) ?? '', ',') : [body];
            items.forEach(item => parseItem(item, table));
        }
    }

    return buildModel([...tables.values()]);
}

function buildModel(rawTables: RawTable[]): ErModel {
    const byKey = new Map<string, ErTable>();
    const byName = new Map<string, ErTable[]>();
    const raws = new Map<string, RawTable>();
    const idOf = (schema: string, name: string) => schema ? `${schema}.${name}` : name;

    const register = (table: ErTable) => {
        byKey.set(tableKey(table.schema, table.name), table);
        const list = byName.get(table.name.toLowerCase()) ?? [];
        list.push(table);
        byName.set(table.name.toLowerCase(), list);
    };

    for (const raw of rawTables) {
        const table: ErTable = {
            id: idOf(raw.schema, raw.name), schema: raw.schema, name: raw.name, columns: raw.columns, external: false, file: raw.file
        };
        raws.set(table.id, raw);
        register(table);
    }

    const resolve = (from: ErTable, ref: RefTarget): ErTable => {
        const exact = ref.schema ? byKey.get(tableKey(ref.schema, ref.table)) : undefined;
        if (exact) { return exact; }
        if (!ref.schema) {
            const candidates = byName.get(ref.table.toLowerCase()) ?? [];
            const found = candidates.find(t => t.schema === from.schema) ?? candidates[0];
            if (found) { return found; }
        }
        // Referenced but never created here (e.g. auth.users): keep it visible as an external table
        const stub: ErTable = { id: idOf(ref.schema, ref.table), schema: ref.schema, name: ref.table, columns: [], external: true };
        register(stub);
        return stub;
    };

    const relations: ErRelation[] = [];
    const tables = [...byKey.values()];
    for (const table of [...tables]) {
        const raw = raws.get(table.id);
        if (!raw) { continue; }
        const pkSet = raw.primaryKey.map(c => c.toLowerCase()).sort().join(',');
        for (const col of table.columns) {
            col.primaryKey = raw.primaryKey.some(p => p.toLowerCase() === col.name.toLowerCase());
            if (col.primaryKey) { col.nullable = false; }
        }
        raw.foreignKeys.forEach((fk, i) => {
            const target = resolve(table, fk.ref);
            const targetRaw = raws.get(target.id);
            const targetColumns = fk.refColumns.length > 0 ? fk.refColumns : (targetRaw?.primaryKey ?? []);
            const fkSet = fk.columns.map(c => c.toLowerCase()).sort().join(',');
            const isUnique = fkSet === pkSet || raw.uniques.some(u => u.map(c => c.toLowerCase()).sort().join(',') === fkSet)
                || (fk.columns.length === 1 && table.columns.some(c => c.unique && c.name.toLowerCase() === fkSet));
            const sourceCols = fk.columns.map(name => table.columns.find(c => c.name.toLowerCase() === name.toLowerCase()));
            sourceCols.forEach(c => { if (c) { c.foreignKey = true; } });
            // Only columns the SQL actually named are known for external tables
            if (target.external) {
                for (const name of targetColumns) {
                    if (!target.columns.some(c => c.name === name)) {
                        target.columns.push({ name, type: '', primaryKey: true, foreignKey: false, unique: false, nullable: false });
                    }
                }
            }
            relations.push({
                id: `${table.id}#${fk.name ?? fk.columns.join(',')}#${i}`,
                source: table.id,
                target: target.id,
                sourceColumns: fk.columns,
                targetColumns,
                name: fk.name,
                oneToOne: isUnique,
                nullable: sourceCols.some(c => c?.nullable ?? true)
            });
        });
    }

    const sortedTables = [...byKey.values()].sort((a, b) => a.id.localeCompare(b.id));
    return { tables: sortedTables, relations };
}

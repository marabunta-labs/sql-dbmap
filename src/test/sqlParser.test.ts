import { test } from 'node:test';
import * as assert from 'node:assert';
import { parseSql, splitStatements } from '../parser/sqlParser';

const parse = (sql: string) => parseSql([{ path: 'test.sql', sql }]);
const table = (m: ReturnType<typeof parse>, id: string) => m.tables.find(t => t.id === id)!;

test('splitStatements strips comments, keeps quoted text and honours GO and /', () => {
    const sql = `-- header\nSELECT 'a;b'; /* x; y */ SELECT 2;\nSELECT 3\nGO\nSELECT 4\n/\n$$ a;b $$;`;
    assert.deepStrictEqual(splitStatements(sql), ["SELECT 'a;b'", 'SELECT 2', 'SELECT 3', 'SELECT 4', '$$ a;b $$']);
});

test('PostgreSQL: inline and table constraints, schemas, ALTER TABLE, external tables', () => {
    const m = parse(`
        CREATE SCHEMA app;
        CREATE TABLE IF NOT EXISTS app.profiles (
            id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
            email text NOT NULL UNIQUE,
            tags text[] DEFAULT '{}',
            price numeric(10, 2) DEFAULT 0 NOT NULL,
            created_at timestamp with time zone NOT NULL DEFAULT now()
        );
        CREATE TABLE app.posts (
            id bigserial,
            author_id uuid NOT NULL,
            body text,
            PRIMARY KEY (id),
            CONSTRAINT posts_author_fk FOREIGN KEY (author_id) REFERENCES app.profiles (id)
        );
        CREATE TABLE app.comments (id int, post_id bigint, note text, key text);
        ALTER TABLE ONLY app.comments ADD CONSTRAINT comments_pk PRIMARY KEY (id);
        ALTER TABLE ONLY app.comments ADD CONSTRAINT comments_post_fk FOREIGN KEY (post_id) REFERENCES app.posts(id);
    `);
    assert.deepStrictEqual(m.tables.map(t => t.id), ['app.comments', 'app.posts', 'app.profiles', 'auth.users']);
    const profiles = table(m, 'app.profiles');
    assert.deepStrictEqual(profiles.columns.map(c => [c.name, c.type, c.primaryKey, c.foreignKey, c.unique, c.nullable]), [
        ['id', 'uuid', true, true, false, false],
        ['email', 'text', false, false, true, false],
        ['tags', 'text[]', false, false, false, true],
        ['price', 'numeric(10, 2)', false, false, false, false],
        ['created_at', 'timestamp with time zone', false, false, false, false]
    ]);
    assert.strictEqual(table(m, 'auth.users').external, true);
    assert.deepStrictEqual(table(m, 'auth.users').columns.map(c => c.name), ['id']);
    const authorFk = m.relations.find(r => r.name === 'posts_author_fk')!;
    assert.deepStrictEqual([authorFk.source, authorFk.target, authorFk.sourceColumns, authorFk.targetColumns, authorFk.nullable, authorFk.oneToOne],
        ['app.posts', 'app.profiles', ['author_id'], ['id'], false, false]);
    const profileFk = m.relations.find(r => r.source === 'app.profiles')!;
    assert.deepStrictEqual([profileFk.target, profileFk.oneToOne], ['auth.users', true]); // FK is also the PK
    const comments = table(m, 'app.comments');
    assert.strictEqual(comments.columns.find(c => c.name === 'id')!.primaryKey, true);
    assert.ok(comments.columns.some(c => c.name === 'key'), 'a column called "key" is still a column');
    assert.strictEqual(m.relations.find(r => r.source === 'app.comments')!.target, 'app.posts');
});

test('MySQL: backticks, KEY/INDEX lines, unsigned ints and table options', () => {
    const m = parse(`
        CREATE TABLE \`users\` (
          \`id\` int(11) unsigned NOT NULL AUTO_INCREMENT,
          \`name\` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT 'not null',
          \`role\` enum('a','b') DEFAULT NULL,
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`uq_name\` (\`name\`),
          KEY \`idx_role\` (\`role\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        CREATE TABLE \`orders\` (
          \`id\` int NOT NULL,
          \`user_id\` int NOT NULL,
          PRIMARY KEY (\`id\`),
          KEY \`fk_user\` (\`user_id\`),
          CONSTRAINT \`fk_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
        ) ENGINE=InnoDB;
    `);
    assert.deepStrictEqual(table(m, 'users').columns.map(c => [c.name, c.type, c.nullable]), [
        ['id', 'int(11) unsigned', false], ['name', 'varchar(100)', false], ['role', "enum('a','b')", true]
    ]);
    assert.strictEqual(table(m, 'users').columns[1].unique, false);
    assert.deepStrictEqual(m.relations.map(r => [r.source, r.target, r.targetColumns]), [['orders', 'users', ['id']]]);
    assert.strictEqual(table(m, 'orders').columns.length, 2);
});

test('T-SQL: brackets, IDENTITY, GO and WITH CHECK ADD CONSTRAINT', () => {
    const m = parse(`
        CREATE TABLE [dbo].[Customer](
            [Id] [int] IDENTITY(1,1) NOT NULL,
            [Name] [nvarchar](50) NULL,
            CONSTRAINT [PK_Customer] PRIMARY KEY CLUSTERED ([Id] ASC) WITH (PAD_INDEX = OFF) ON [PRIMARY]
        ) ON [PRIMARY]
        GO
        CREATE TABLE [dbo].[Invoice](
            [Id] [int] NOT NULL,
            [CustomerId] [int] NOT NULL
        )
        GO
        ALTER TABLE [dbo].[Invoice] WITH CHECK ADD CONSTRAINT [FK_Invoice_Customer] FOREIGN KEY([CustomerId]) REFERENCES [dbo].[Customer] ([Id])
        GO
        ALTER TABLE [dbo].[Invoice] CHECK CONSTRAINT [FK_Invoice_Customer]
        GO
    `);
    assert.deepStrictEqual(table(m, 'dbo.Customer').columns.map(c => [c.name, c.type, c.primaryKey, c.nullable]), [
        ['Id', 'int', true, false], ['Name', 'nvarchar(50)', false, true]
    ]);
    assert.deepStrictEqual(m.relations.map(r => [r.source, r.target, r.name]), [['dbo.Invoice', 'dbo.Customer', 'FK_Invoice_Customer']]);
});

test('Oracle: quoted identifiers, VARCHAR2 CHAR, identity columns, ADD (...) and inline constraints', () => {
    const m = parse(`
        CREATE TABLE "HR"."DEPT" (
            "ID" NUMBER GENERATED ALWAYS AS IDENTITY NOT NULL,
            "NAME" VARCHAR2(50 CHAR) NOT NULL,
            CONSTRAINT "DEPT_PK" PRIMARY KEY ("ID") USING INDEX ENABLE
        );
        CREATE TABLE "HR"."EMP" (
            "ID" NUMBER(10) NOT NULL,
            "DEPT_ID" NUMBER(10) CONSTRAINT "EMP_DEPT_FK" REFERENCES "HR"."DEPT" ("ID")
        );
        ALTER TABLE "HR"."EMP" ADD ("SALARY" NUMBER(8,2), CONSTRAINT "EMP_PK" PRIMARY KEY ("ID"));
        COMMENT ON TABLE "HR"."EMP" IS 'employees; all of them';
    `);
    assert.deepStrictEqual(table(m, 'HR.EMP').columns.map(c => [c.name, c.type, c.primaryKey, c.foreignKey, c.nullable]), [
        ['ID', 'NUMBER(10)', true, false, false], ['DEPT_ID', 'NUMBER(10)', false, true, true], ['SALARY', 'NUMBER(8,2)', false, false, true]
    ]);
    assert.strictEqual(table(m, 'HR.DEPT').columns[1].type, 'VARCHAR2(50 CHAR)');
    assert.deepStrictEqual(m.relations.map(r => [r.source, r.target, r.nullable]), [['HR.EMP', 'HR.DEPT', true]]);
});

test('unqualified references resolve within the same schema, self references and composite keys work', () => {
    const m = parse(`
        CREATE TABLE a.node (id int PRIMARY KEY, parent_id int REFERENCES node(id));
        CREATE TABLE b.node (id int PRIMARY KEY);
        CREATE TABLE a.pair (x int, y int, PRIMARY KEY (x, y));
        CREATE TABLE a.link (x int, y int, UNIQUE (x, y), FOREIGN KEY (x, y) REFERENCES pair);
    `);
    assert.strictEqual(m.relations.find(r => r.source === 'a.node')!.target, 'a.node');
    const link = m.relations.find(r => r.source === 'a.link')!;
    assert.deepStrictEqual([link.target, link.targetColumns, link.oneToOne], ['a.pair', ['x', 'y'], true]);
});

test('garbage and unsupported statements are ignored', () => {
    const m = parse(`SELECT 1; CREATE VIEW v AS SELECT 1; CREATE TABLE broken (id int; INSERT INTO t VALUES (1);`);
    assert.deepStrictEqual(m, { tables: [], relations: [] });
});

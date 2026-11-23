export interface ErColumn {
    name: string;
    type: string;
    primaryKey: boolean;
    foreignKey: boolean;
    unique: boolean;
    nullable: boolean;
}

export interface ErTable {
    id: string;
    /** Empty string when the SQL never qualified the table name. */
    schema: string;
    name: string;
    columns: ErColumn[];
    /** Referenced by a foreign key but never created in the parsed SQL. */
    external: boolean;
    file?: string;
}

export interface ErRelation {
    id: string;
    /** Table that owns the foreign key (the "many" side). */
    source: string;
    /** Referenced table. */
    target: string;
    sourceColumns: string[];
    targetColumns: string[];
    name?: string;
    /** The foreign key columns are unique, so the relation is one-to-one. */
    oneToOne: boolean;
    nullable: boolean;
}

export interface ErModel {
    tables: ErTable[];
    relations: ErRelation[];
}

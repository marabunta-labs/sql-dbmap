-- Demo schema (PostgreSQL): two app schemas, a self reference, a 1:1 relation and an external table.
CREATE SCHEMA shop;
CREATE SCHEMA billing;

CREATE TABLE shop.customers (
    id          uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    email       text NOT NULL UNIQUE,
    full_name   text,
    referred_by uuid REFERENCES shop.customers (id),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop.customer_profiles (
    customer_id uuid PRIMARY KEY REFERENCES shop.customers (id),
    bio         text,
    avatar_url  text
);

CREATE TABLE shop.categories (
    id        serial PRIMARY KEY,
    parent_id integer REFERENCES shop.categories (id),
    name      varchar(80) NOT NULL
);

CREATE TABLE shop.products (
    id          bigserial PRIMARY KEY,
    category_id integer NOT NULL REFERENCES shop.categories (id),
    sku         varchar(32) NOT NULL UNIQUE,
    name        text NOT NULL,
    price       numeric(10, 2) NOT NULL,
    tags        text[]
);

CREATE TABLE shop.orders (
    id          bigserial PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES shop.customers (id),
    status      text NOT NULL DEFAULT 'new',
    placed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop.order_items (
    order_id   bigint NOT NULL,
    product_id bigint NOT NULL,
    quantity   integer NOT NULL DEFAULT 1,
    PRIMARY KEY (order_id, product_id),
    FOREIGN KEY (order_id) REFERENCES shop.orders (id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES shop.products (id)
);

CREATE TABLE billing.invoices (
    id          bigserial PRIMARY KEY,
    order_id    bigint,
    customer_id uuid NOT NULL,
    total       numeric(12, 2) NOT NULL,
    issued_at   date NOT NULL
);

CREATE TABLE billing.payments (
    id         bigserial PRIMARY KEY,
    invoice_id bigint NOT NULL,
    amount     numeric(12, 2) NOT NULL,
    method     text
);

CREATE TABLE billing.tax_rates (
    country char(2) PRIMARY KEY,
    rate    numeric(5, 2) NOT NULL
);

ALTER TABLE ONLY billing.invoices ADD CONSTRAINT invoices_order_fk FOREIGN KEY (order_id) REFERENCES shop.orders (id);
ALTER TABLE ONLY billing.invoices ADD CONSTRAINT invoices_customer_fk FOREIGN KEY (customer_id) REFERENCES shop.customers (id);
ALTER TABLE ONLY billing.payments ADD CONSTRAINT payments_invoice_fk FOREIGN KEY (invoice_id) REFERENCES billing.invoices (id);

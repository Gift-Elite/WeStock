-- seed roles and a default admin
INSERT OR IGNORE INTO roles (id, name) VALUES (1, 'admin');
INSERT OR IGNORE INTO roles (id, name) VALUES (2, 'cashier');
INSERT OR IGNORE INTO roles (id, name) VALUES (3, 'clerk');

-- example items
INSERT OR IGNORE INTO items (id, sku, name, quantity, box_quantity, low_threshold, medium_threshold) VALUES (1, 'SKU-001', 'Sample Item A', 50, 5, 5, 20);
INSERT OR IGNORE INTO items (id, sku, name, quantity, box_quantity, low_threshold, medium_threshold) VALUES (2, 'SKU-002', 'Sample Item B', 8, 2, 5, 20);

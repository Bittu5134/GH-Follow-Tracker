DROP TABLE IF EXISTS users;

CREATE TABLE users (
    username TEXT PRIMARY KEY,
    token TEXT DEFAULT NULL,
    webhooks TEXT DEFAULT '[]'
);
CREATE DATABASE IF NOT EXISTS pixels ON CLUSTER 'ch-prod-cluster';

CREATE TABLE IF NOT EXISTS pixels.validation_results_2 ON CLUSTER 'ch-prod-cluster' (
    date Date,
    agent String,
    version String,
    pixel_id String,
    pixel String,
    prefix String,
    params Array(String),
    freq Int64,
    status Int32,
    owners Array(String),
    errors Array(String)
)
ENGINE = ReplicatedReplacingMergeTree()
PARTITION BY (date)
ORDER BY (agent, prefix, params)
TTL date + INTERVAL 28 DAY;

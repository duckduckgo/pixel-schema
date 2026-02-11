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

CREATE TABLE IF NOT EXISTS pixels.daily_validation_results ON CLUSTER 'ch-prod-cluster' (
    date Date,
    agent String,
    total_impressions UInt64,
    valid UInt64,
    invalid UInt64,
    old_app_version UInt64,
    undocumented UInt64,
    parameter_permutations UInt64
) ENGINE = ReplicatedReplacingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, agent);

CREATE TABLE IF NOT EXISTS pixels.daily_valid_prefix_results ON CLUSTER 'ch-prod-cluster' (
    date Date,
    agent String,
    prefix String,
    total_impressions UInt64,
    valid UInt64,
    invalid UInt64,
    old_app_version UInt64,
    undocumented UInt64,
    parameter_perms UInt64,
    owners Array(String),
    errors Array(String)
) ENGINE = ReplicatedReplacingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, agent, prefix);

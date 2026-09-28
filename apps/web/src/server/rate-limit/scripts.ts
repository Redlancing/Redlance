import "server-only";

/**
 * Token bucket. KEYS[1] = bucket key. ARGV = capacity, refill per ms, cost.
 * Uses the Redis clock so several app servers agree on time.
 * Returns { allowed (0|1), remaining tokens (floored), retry after ms }.
 */
export const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end
tokens = math.min(capacity, tokens + math.max(0, now - ts) * refill_per_ms)
local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end
redis.call('HSET', key, 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', key, math.ceil(capacity / refill_per_ms) + 1000)
local retry_ms = 0
if allowed == 0 then
  retry_ms = math.ceil((cost - tokens) / refill_per_ms)
end
return { allowed, math.floor(tokens), retry_ms }
`;

/**
 * Daily quota. KEYS[1] = quota key (includes the UTC date). ARGV = limit, ttl seconds.
 * Returns { allowed (0|1), count after this call }.
 */
export const QUOTA_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
if count > tonumber(ARGV[1]) then
  return { 0, count }
end
return { 1, count }
`;

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env var: ${name}`);
  return String(v);
}

function getDocClient() {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const client = new DynamoDBClient(region ? { region } : {});
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
}

function readNdjsonLines(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`NDJSON not found: ${filePath}`);
  const text = fs.readFileSync(filePath, 'utf8');
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(JSON.parse);
}

async function batchWriteWithRetry(docClient, tableName, requests, maxAttempts = 5) {
  let unprocessed = requests;
  let attempt = 0;
  while (unprocessed.length > 0 && attempt < maxAttempts) {
    attempt += 1;
    const batch = unprocessed.slice(0, 25);
    const params = { RequestItems: { [tableName]: batch.map(Item => ({ PutRequest: { Item } })) } };
    const res = await docClient.send(new BatchWriteCommand(params));
    const rem = (res.UnprocessedItems && res.UnprocessedItems[tableName]) || [];
    if (rem.length === 0) {
      unprocessed = unprocessed.slice(25);
    } else {
      // retry unprocessed with backoff
      unprocessed = rem.map(r => r.PutRequest.Item).concat(unprocessed.slice(25));
      const delay = Math.min(2000 * attempt, 15000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  if (unprocessed.length > 0) {
    throw new Error(`Failed to write ${unprocessed.length} item(s) after ${maxAttempts} attempts`);
  }
}

async function main() {
  const localRoot = path.resolve(process.env.LOCAL_DATA_PATH || path.join(__dirname, '..', '..', '..', 'Movie-data'));
  const ndjsonPath = path.join(localRoot, 'movies', 'movies.ndjson');
  const tableName = process.argv[2] || process.env.DDB_TABLE_NAME || 'reLivre-movies';

  console.log(`[Push] LOCAL_DATA_PATH=${localRoot}`);
  console.log(`[Push] Table=${tableName}`);

  const docClient = getDocClient();
  const lines = readNdjsonLines(ndjsonPath);

  // Prepare items: ensure primary key `imdbId` exists; fallback to `key`.
  const items = lines.map(m => {
    const copy = { ...m };
    const pk = String(copy.imdbId || copy.key || '').trim();
    if (!pk) throw new Error(`Missing primary key for movie: ${JSON.stringify({ title: copy.title, year: copy.year })}`);
    // Use `imdbId` as the table key attribute name if present, else use `key` attribute.
    if (copy.imdbId) {
      copy.imdbId = String(copy.imdbId);
    } else {
      copy.imdbId = String(copy.key);
    }
    return copy;
  });

  console.log(`[Push] Loaded ${items.length} movie records from NDJSON`);

  // Chunk into batches of 25
  const batches = [];
  for (let i = 0; i < items.length; i += 25) batches.push(items.slice(i, i + 25));

  for (let i = 0; i < batches.length; i++) {
    try {
      await batchWriteWithRetry(docClient, tableName, batches[i]);
      process.stdout.write(`\r[Push] Batch ${i + 1}/${batches.length} OK`);
    } catch (err) {
      console.error(`\n[Push] Batch ${i + 1} failed: ${err.message}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log('\n[Push] All batches written successfully.');
}

main().catch(err => { console.error(err?.stack || err?.message || String(err)); process.exit(1); });

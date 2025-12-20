#!/usr/bin/env node

import * as cdk from 'aws-cdk-lib';
import { MoviesTableStack } from '../lib/movies-table-stack';
import { ReLivreAppStack } from '../lib/relivre-app-stack';

const app = new cdk.App();

// Let CDK pick up account/region from your AWS CLI profile / env.
// You can override region by setting AWS_REGION.
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION,
};

new MoviesTableStack(app, 'ReLivreMoviesTableStack', { env });
new ReLivreAppStack(app, 'ReLivreAppStack', {
  env,
  tableName: 'reLivre-movies',
  // If set locally, CDK will bake it into Lambda env vars.
  // Otherwise, Lambda will read from SSM SecureString parameter: /relivre/openai_api_key
  openAiApiKey: process.env.OPENAI_API_KEY,
});

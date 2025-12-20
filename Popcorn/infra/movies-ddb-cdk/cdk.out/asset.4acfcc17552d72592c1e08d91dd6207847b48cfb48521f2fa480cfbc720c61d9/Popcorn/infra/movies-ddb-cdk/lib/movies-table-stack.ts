import * as cdk from 'aws-cdk-lib';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class MoviesTableStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'MoviesTable', {
      tableName: 'reLivre-movies',
      partitionKey: { name: 'imdbId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Optional: query by titleLower (e.g., exact/starts-with patterns you might add later)
    table.addGlobalSecondaryIndex({
      indexName: 'TitleLowerIndex',
      partitionKey: { name: 'titleLower', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'year', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    new cdk.CfnOutput(this, 'MoviesTableName', { value: table.tableName });
  }
}

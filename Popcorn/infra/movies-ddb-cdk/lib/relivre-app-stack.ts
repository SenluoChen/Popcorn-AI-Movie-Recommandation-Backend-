import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';

export interface ReLivreAppStackProps extends cdk.StackProps {
  tableName?: string;
  openAiApiKey?: string;
  openAiApiKeySsmParamName?: string;
}

export class ReLivreAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ReLivreAppStackProps) {
    super(scope, id, props);

    const tableName = (props.tableName || 'reLivre-movies').trim();
    const ssmParamName = (props.openAiApiKeySsmParamName || '/relivre/openai_api_key').trim();

    // ---- Vector backend: FAISS service on ECS Fargate (public ALB)
    const vpc = new ec2.Vpc(this, 'VectorVpc', {
      maxAzs: 2,
      natGateways: 0,
    });

    const cluster = new ecs.Cluster(this, 'VectorCluster', {
      vpc,
    });

    // Store FAISS index assets in S3, and let the service download them at startup.
    const indexBucket = new s3.Bucket(this, 'FaissIndexBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    const workspaceRoot = path.join(__dirname, '..', '..', '..', '..');
    new s3deploy.BucketDeployment(this, 'DeployFaissIndex', {
      destinationBucket: indexBucket,
      destinationKeyPrefix: 'index',
      sources: [s3deploy.Source.asset(path.join(workspaceRoot, 'Movie-data', 'index'))],
    });

    // Docker build context: minimal folder inside the CDK app (avoids Windows symlink issues)
    const imageAsset = new ecrAssets.DockerImageAsset(this, 'FaissVectorServiceImage', {
      directory: path.join(__dirname, '..', 'vector-service-ecs'),
      file: 'Dockerfile',
    });

    const faissService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'FaissVectorService', {
      cluster,
      desiredCount: 1,
      publicLoadBalancer: true,
      assignPublicIp: true,
      cpu: 256,
      memoryLimitMiB: 512,
      taskImageOptions: {
        image: ecs.ContainerImage.fromDockerImageAsset(imageAsset),
        containerPort: 8008,
        environment: {
          LOCAL_DATA_PATH: '/opt/data',
          INDEX_BUCKET: indexBucket.bucketName,
          INDEX_PREFIX: 'index',
        },
      },
      healthCheckGracePeriod: cdk.Duration.seconds(30),
    });

    indexBucket.grantRead(faissService.taskDefinition.taskRole);

    faissService.targetGroup.configureHealthCheck({
      path: '/health',
      healthyHttpCodes: '200',
    });

    // ---- Backend: HTTP API -> Lambda
    const searchFn = new lambda.Function(this, 'SearchFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'search')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        DDB_TABLE_NAME: tableName,
        FAISS_SERVICE_URL: `http://${faissService.loadBalancer.loadBalancerDnsName}`,
        ...(props.openAiApiKey ? { OPENAI_API_KEY: props.openAiApiKey } : { OPENAI_API_KEY_SSM_PARAM: ssmParamName }),
        OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
      },
    });

    // Least-privilege: Scan is enough for current implementation
    searchFn.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['dynamodb:Scan', 'dynamodb:BatchGetItem', 'dynamodb:GetItem'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}`,
        ],
      }),
    );

    if (!props.openAiApiKey) {
      // Allow Lambda to read the SecureString parameter at runtime.
      const normalized = ssmParamName.startsWith('/') ? ssmParamName.slice(1) : ssmParamName;
      searchFn.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ['ssm:GetParameter'],
          resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${normalized}`],
        }),
      );
    }

    const httpApi = new apigwv2.HttpApi(this, 'ReLivreHttpApi', {
      corsPreflight: {
        allowHeaders: ['content-type'],
        allowMethods: [apigwv2.CorsHttpMethod.OPTIONS, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.GET],
        allowOrigins: ['*'],
      },
    });

    httpApi.addRoutes({
      path: '/search',
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS],
      integration: new apigwv2Integrations.HttpLambdaIntegration('SearchIntegration', searchFn),
    });

    // ---- Frontend: S3 + CloudFront (SPA)
    const siteBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    const oai = new cloudfront.OriginAccessIdentity(this, 'FrontendOAI');
    siteBucket.grantRead(oai);

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(siteBucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
    });

    // Deploy CRA build output (repo root /build) to S3
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      destinationBucket: siteBucket,
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', '..', 'build'))],
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'FrontendUrl', { value: `https://${distribution.domainName}` });
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.url ?? '' });
    new cdk.CfnOutput(this, 'MoviesTableNameForApi', { value: tableName });
    new cdk.CfnOutput(this, 'OpenAiApiKeySsmParam', { value: ssmParamName });
    new cdk.CfnOutput(this, 'FaissServiceUrl', { value: `http://${faissService.loadBalancer.loadBalancerDnsName}` });
    new cdk.CfnOutput(this, 'FaissIndexBucketName', { value: indexBucket.bucketName });
  }
}

"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReLivreAppStack = void 0;
const path = __importStar(require("path"));
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const s3deploy = __importStar(require("aws-cdk-lib/aws-s3-deployment"));
const cloudfront = __importStar(require("aws-cdk-lib/aws-cloudfront"));
const origins = __importStar(require("aws-cdk-lib/aws-cloudfront-origins"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const apigwv2 = __importStar(require("aws-cdk-lib/aws-apigatewayv2"));
const apigwv2Integrations = __importStar(require("aws-cdk-lib/aws-apigatewayv2-integrations"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const ecsPatterns = __importStar(require("aws-cdk-lib/aws-ecs-patterns"));
const ecrAssets = __importStar(require("aws-cdk-lib/aws-ecr-assets"));
class ReLivreAppStack extends cdk.Stack {
    constructor(scope, id, props) {
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
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN,
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
        searchFn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ['dynamodb:Scan', 'dynamodb:BatchGetItem', 'dynamodb:GetItem'],
            resources: [
                `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}`,
            ],
        }));
        if (!props.openAiApiKey) {
            // Allow Lambda to read the SecureString parameter at runtime.
            const normalized = ssmParamName.startsWith('/') ? ssmParamName.slice(1) : ssmParamName;
            searchFn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
                actions: ['ssm:GetParameter'],
                resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${normalized}`],
            }));
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
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.RETAIN,
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
exports.ReLivreAppStack = ReLivreAppStack;

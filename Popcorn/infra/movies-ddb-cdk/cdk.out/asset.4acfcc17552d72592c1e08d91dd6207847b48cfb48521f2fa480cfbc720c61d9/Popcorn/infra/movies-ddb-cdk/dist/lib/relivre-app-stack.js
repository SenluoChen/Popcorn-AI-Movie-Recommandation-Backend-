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
class ReLivreAppStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const tableName = (props.tableName || 'reLivre-movies').trim();
        const ssmParamName = (props.openAiApiKeySsmParamName || '/relivre/openai_api_key').trim();
        // ---- Backend: HTTP API -> Lambda
        const searchFn = new lambda.Function(this, 'SearchFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'search')),
            memorySize: 512,
            timeout: cdk.Duration.seconds(30),
            environment: {
                DDB_TABLE_NAME: tableName,
                ...(props.openAiApiKey ? { OPENAI_API_KEY: props.openAiApiKey } : { OPENAI_API_KEY_SSM_PARAM: ssmParamName }),
                OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
            },
        });
        // Least-privilege: Scan is enough for current implementation
        searchFn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
            actions: ['dynamodb:Scan'],
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
    }
}
exports.ReLivreAppStack = ReLivreAppStack;

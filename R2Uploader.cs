using Amazon.S3;
using Amazon.S3.Model;

public sealed class R2Uploader
{
    private readonly IAmazonS3 _s3;
    private readonly string _bucket;

    public R2Uploader()
    {
        var accountId = Environment.GetEnvironmentVariable("CF_R2_ACCOUNT_ID")
                        ?? throw new InvalidOperationException("Missing CF_R2_ACCOUNT_ID");
        var accessKey = Environment.GetEnvironmentVariable("CF_R2_ACCESS_KEY_ID")
                        ?? throw new InvalidOperationException("Missing CF_R2_ACCESS_KEY_ID");
        var secretKey = Environment.GetEnvironmentVariable("CF_R2_SECRET_ACCESS_KEY")
                        ?? throw new InvalidOperationException("Missing CF_R2_SECRET_ACCESS_KEY");
        _bucket = Environment.GetEnvironmentVariable("CF_R2_BUCKET")
                  ?? throw new InvalidOperationException("Missing CF_R2_BUCKET");

        var config = new AmazonS3Config
        {
            ServiceURL = $"https://{accountId}.r2.cloudflarestorage.com",
            ForcePathStyle = true
        };

        _s3 = new AmazonS3Client(accessKey, secretKey, config);
    }

    public async Task UploadJsonAsync(string key, string json, CancellationToken ct = default)
    {
        var request = new PutObjectRequest
        {
            BucketName = _bucket,
            Key = key,
            ContentBody = json,
            UseChunkEncoding = false,
            ContentType = "application/json"
        };

        await _s3.PutObjectAsync(request, ct);
    }
}

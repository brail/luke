#!/bin/sh
# Renders SeaweedFS's S3-gateway identity config from env vars, then starts the
# all-in-one server (master + volume + filer + S3 gateway) against /data.
#
# SeaweedFS has no MinIO-style MINIO_ROOT_USER/PASSWORD env-var auth — the S3
# gateway reads credentials from a JSON identity file instead (`-s3.config`).
# This script exists only to bridge the two: same env-var-driven credential
# pattern the compose files already use, rendered into the file SeaweedFS wants.
set -eu

: "${S3_ROOT_USER:?S3_ROOT_USER not set}"
: "${S3_ROOT_PASSWORD:?S3_ROOT_PASSWORD not set}"

mkdir -p /etc/seaweedfs
cat > /etc/seaweedfs/s3.json <<EOF
{
  "identities": [
    {
      "name": "root",
      "credentials": [
        { "accessKey": "${S3_ROOT_USER}", "secretKey": "${S3_ROOT_PASSWORD}" }
      ],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
EOF

# `weed volume`'s -max defaults to a hardcoded 8 volume slots (NOT disk-space-based
# despite what -max=0 would auto-compute) — SeaweedFS allocates one volume per S3
# bucket ("collection" in its terms), so 8 buckets is where writes start failing
# with "No writable volumes and no free volumes left". Volumes aren't preallocated
# to their size limit (they grow with actual data), so raising this costs nothing
# on disk — just headroom for Luke's ~9 real buckets plus test/probe traffic.
exec weed server -dir=/data -s3 -s3.config=/etc/seaweedfs/s3.json -ip.bind=0.0.0.0 -volume.max=100

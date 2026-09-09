#!/bin/sh
# Self-signed cert for *.localtest.me + SPKI hash for --ignore-certificate-errors-spki-list.
set -e
cd "$(dirname "$0")"
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 \
  -subj "/CN=localtest.me" \
  -addext "subjectAltName=DNS:*.localtest.me,DNS:localtest.me,DNS:localhost" 2>/dev/null
openssl x509 -in cert.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64 > spki.txt
echo "cert.pem key.pem spki.txt written; spki=$(cat spki.txt)"

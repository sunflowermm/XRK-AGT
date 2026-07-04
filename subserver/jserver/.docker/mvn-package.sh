#!/bin/sh
# Docker build 内 Maven 打包：mirror settings + 可选 HTTP 代理（排除国内镜像域名，避免 502）
set -eu

BASE_SETTINGS="/src/.docker/settings.xml"
SETTINGS="/tmp/mvn-settings.xml"

proxy="${HTTPS_PROXY:-${HTTP_PROXY:-}}"
if [ -n "$proxy" ]; then
  host=$(echo "$proxy" | sed -E 's|^[a-zA-Z]+://([^:/]+).*|\1|')
  port=$(echo "$proxy" | sed -E 's|^[a-zA-Z]+://[^:/]+:([0-9]+).*|\1|')
  [ -z "$port" ] && port=80
  awk -v host="$host" -v port="$port" '
    /<proxies\/>/ {
      print "  <proxies>"
      print "    <proxy>"
      print "      <id>docker-build</id>"
      print "      <active>true</active>"
      print "      <protocol>http</protocol>"
      print "      <host>" host "</host>"
      print "      <port>" port "</port>"
      print "      <nonProxyHosts>localhost|127.0.0.1|*.local|host.docker.internal|*.aliyun.com|mirrors.cloud.tencent.com|repo.huaweicloud.com</nonProxyHosts>"
      print "    </proxy>"
      print "  </proxies>"
      next
    }
    { print }
  ' "$BASE_SETTINGS" > "$SETTINGS"
else
  cp "$BASE_SETTINGS" "$SETTINGS"
fi

attempt=1
max=3
while [ "$attempt" -le "$max" ]; do
  if mvn -s "$SETTINGS" -q -DskipTests package "$@"; then
    exit 0
  fi
  echo ">>> mvn 第 ${attempt}/${max} 次失败，重试..."
  attempt=$((attempt + 1))
  sleep 5
done
exit 1

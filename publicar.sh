#!/bin/sh
# Monta a pasta "publicar/" só com o sistema real (sem testes, sem modo de demonstração).
# Antes de publicar uma versão nova: trocar o ?v= no index.html e o CACHE no sw.js.
cd "$(dirname "$0")"
rm -rf publicar && mkdir -p publicar/js/telas
cp index.html manifest.webmanifest sw.js publicar/
cp -r css assets publicar/
cp js/*.js publicar/js/ && rm -f publicar/js/demo.js
cp js/telas/*.js publicar/js/telas/
cat > publicar/_headers <<'H'
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
H
echo "pronto: $(find publicar -type f | wc -l) arquivos em publicar/"

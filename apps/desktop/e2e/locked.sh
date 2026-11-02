#!/bin/sh
# Vários agentes usam a mesma pasta `out/`: build e fotos passam um de cada vez.
until mkdir /tmp/sektor.lock 2>/dev/null; do sleep 2; done
trap 'rmdir /tmp/sektor.lock' EXIT
"$@"

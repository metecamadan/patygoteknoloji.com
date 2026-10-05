#!/usr/bin/env bash
# GitHub Actions -> VPS SSH path drops full-size (1500 byte) packets without sending ICMP
# "fragmentation needed", so deploy sessions hang right after auth. Advertising a smaller MSS
# on port 22 SYN-ACKs makes peers send segments that fit. Port 22 only; 80/443 untouched.
set -euo pipefail

MSS="${1:-1240}"
UNIT=/etc/systemd/system/ssh-mss-clamp.service
RULE="OUTPUT -p tcp --sport 22 --tcp-flags SYN,RST SYN -j TCPMSS --set-mss ${MSS}"

cat > "${UNIT}.tmp" <<EOF
[Unit]
Description=Clamp TCP MSS on SSH (port 22) for PMTU blackhole on deploy path
After=network-pre.target ufw.service
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -t mangle -C ${RULE} 2>/dev/null || iptables -t mangle -A ${RULE}'

[Install]
WantedBy=multi-user.target
EOF

if ! cmp -s "${UNIT}.tmp" "${UNIT}" 2>/dev/null; then
  mv "${UNIT}.tmp" "${UNIT}"
  systemctl daemon-reload
  echo "ssh-mss-clamp unit written (mss ${MSS})"
else
  rm -f "${UNIT}.tmp"
fi
systemctl enable --now ssh-mss-clamp.service >/dev/null 2>&1
iptables -t mangle -C ${RULE} 2>/dev/null || iptables -t mangle -A ${RULE}
echo "ssh mss clamp active: $(iptables -t mangle -S OUTPUT | grep -c 'TCPMSS --set-mss') rule(s)"

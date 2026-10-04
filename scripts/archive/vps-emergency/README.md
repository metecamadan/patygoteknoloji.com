# Archived VPS emergency scripts

These `_*.py` files were one-off Paramiko/VPS patches and smokes used when GitHub Actions SSH deploy was broken or bypassed.

**Production deploy path:** GitHub Actions → **Deploy over SSH** (`appleboy/ssh-action`) on `main` after tests pass. That is the real gate.

These scripts still read the old root password file (`~/Desktop/_migrate_pass.local`), which is being retired in favour of key-based SSH. They will not connect once password login is disabled on the VPS. If one is ever needed again, connect through `scripts/vps_ssh.py` (`from vps_ssh import connect`) instead of reviving the password file.

Do not reintroduce these scripts as the primary deploy or sync path. Temporary live sync via Paramiko is only for emergency recovery while Actions SSH is being fixed — never a substitute for a green Deploy job.

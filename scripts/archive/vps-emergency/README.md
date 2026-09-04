# Archived VPS emergency scripts

These `_*.py` files were one-off Paramiko/VPS patches and smokes used when GitHub Actions SSH deploy was broken or bypassed.

**Production deploy path:** GitHub Actions → **Deploy over SSH** (`appleboy/ssh-action`) on `main` after tests pass. That is the real gate.

Do not reintroduce these scripts as the primary deploy or sync path. Temporary live sync via Paramiko is only for emergency recovery while Actions SSH is being fixed — never a substitute for a green Deploy job.

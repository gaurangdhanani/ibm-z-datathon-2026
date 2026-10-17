# LinuxONE, first time: from zero to the demo on a phone

What you end up with: an IBM LinuxONE virtual server (s390x, Ubuntu) that runs MedVault and serves it over HTTPS at a public URL, plus `reports/bench-s390x.json` for the Dashboard. Budget 45 minutes, most of it waiting. Commands marked **laptop** run in your repo checkout on the Mac; commands marked **VM** run in the SSH session.

Only Python runs on the VM. The frontend is built on the laptop and copied over as `frontend/dist`; FastAPI serves it.

## 1. Get the account

1. Go to the IBM LinuxONE Community Cloud: https://linuxone.cloud.marist.edu/ and choose **Register**. If the datathon organizers gave you a registration link or an event code, use that instead: event accounts last for the event and skip the trial limits.
2. Fill in the form, confirm the e-mail, log in. The trial gives one virtual server for 120 days; event accounts may be shorter. The expiry date is on the instance page.

## 2. Create the virtual server

The portal is a small OpenStack dashboard; menu names below may differ slightly.

1. **Service Catalog → Virtual Servers → Manage Instances → Create**.
2. **Instance name:** `medvault`. **Image:** the newest Ubuntu LTS offered (22.04 or 24.04; the setup script uses `apt`). **Flavor:** the default medium one (2 vCPU, 4 GB) is plenty.
3. **SSH key:** choose **Create a new key pair**, name it `medvault`, and the browser downloads `medvault.pem`. The portal cannot show the private key again, so keep the file. (Or **Upload** your existing `~/.ssh/id_ed25519.pub` and skip the `.pem` steps.)
4. **Create**, then wait until the status is **ACTIVE** (one to three minutes) and copy the **public IP** (usually `148.100.x.x`). Below it is written as `LINUXONE_IP`.

## 3. Connect (laptop)

Move the key somewhere safe and lock its permissions, or `ssh` refuses it:

```bash
mkdir -p ~/.ssh && mv ~/Downloads/medvault.pem ~/.ssh/medvault.pem && chmod 400 ~/.ssh/medvault.pem
```

The login user on every Community Cloud image is `linux1`, with passwordless `sudo`:

```bash
ssh -i ~/.ssh/medvault.pem linux1@LINUXONE_IP
```

Type `yes` at the host-key prompt. You are on the mainframe when this prints `s390x`:

```bash
uname -m
```

Optional, saves typing for the rest of the weekend: add this to `~/.ssh/config` on the laptop, then `ssh linuxone` works, and so do `scp linuxone:...` and the `rsync` below.

```
Host linuxone
  HostName LINUXONE_IP
  User linux1
  IdentityFile ~/.ssh/medvault.pem
```

## 4. Copy the repo over (laptop)

Build the frontend first; the VM has no Node:

```bash
make build
```

Copy everything except the heavy local folders (`frontend/dist` is included):

```bash
rsync -a --exclude .venv --exclude node_modules --exclude data --exclude .git -e "ssh -i ~/.ssh/medvault.pem" ./ linux1@LINUXONE_IP:~/ibm-z/
```

Re-run this same command after every code change.

## 5. Install and smoke-test (VM)

```bash
cd ~/ibm-z && scripts/linuxone_setup.sh
```

Five to ten minutes: `apt` packages (including the distro `python3-cryptography`, there are no s390x wheels), a venv, the pinned Python packages, then the test suite. It ends with `Setup done`. If it fails on `cryptography`, run `sudo apt-get install -y python3-cryptography` and start it again.

Start the server in this session:

```bash
make run
```

Open a second SSH session and run the FND-6 smoke test:

```bash
cd ~/ibm-z && make smoke
```

It prints one line that must contain `s390x`. Paste it into `DECISIONS.md` under FND-6 and tick FND-6 in `TICKETS.md`. From the laptop, check the VM is reachable from outside:

```bash
curl -s http://LINUXONE_IP:8000/api/health
```

If that times out while `ssh` works, see Troubleshooting. Stop `make run` with Ctrl-C before step 7; systemd takes over port 8000 there.

## 6. Benchmark (FND-7)

On the **VM**:

```bash
cd ~/ibm-z && make bench
```

It prints the table and writes `reports/bench-s390x.json` (about a minute). On the **laptop**:

```bash
make bench
```

That writes `reports/bench-arm64.json`. Copy the VM's file back and commit both:

```bash
scp -i ~/.ssh/medvault.pem linux1@LINUXONE_IP:~/ibm-z/reports/bench-s390x.json reports/
```

Sign in as **Demo Control → Dashboard** on either machine to see them side by side (re-run the `rsync` so the VM has the laptop file too).

## 7. Serve over HTTPS (FND-8, VM)

```bash
cd ~/ibm-z && scripts/linuxone_https.sh
```

What it does, once, idempotently:

- writes production settings to `.env` (`MEDVAULT_ENV=prod`, a random `MEDVAULT_SECRET_KEY`, demo personas on) and re-seeds the demo data under the new key;
- installs Caddy (one static binary, built for s390x) and a `Caddyfile` that reverse-proxies to the app and fetches a Let's Encrypt certificate for `148-100-x-y.sslip.io` (sslip.io turns any IP into a DNS name, so no domain is needed);
- installs two systemd services, `medvault` (uvicorn on 127.0.0.1:8000) and `caddy` (ports 80 and 443), enabled at boot;
- waits until `https://…/api/health` answers and prints the URL.

Open that URL on a phone and sign in as Maya Chen; open it on the laptop as Demo Control; fire a scenario. If you own a domain, point an A record at the IP and run `scripts/linuxone_https.sh demo.yourdomain.com` instead.

## 8. Day to day (VM)

| Want | Run |
| --- | --- |
| Deploy new code | laptop: `make build` + the `rsync`; VM: `sudo systemctl restart medvault` |
| Watch logs | `sudo journalctl -u medvault -f` (app) · `sudo journalctl -u caddy -f` (HTTPS) |
| Service status | `systemctl status medvault caddy` |
| Reset demo data | **Demo Control → Reset demo**, or `make seed && sudo systemctl restart medvault` |
| Stop everything | `sudo systemctl stop caddy medvault` |
| Tests on s390x | `make test` |

## Troubleshooting

- **`Permission denied (publickey)`**: wrong user or key. The user is `linux1`; the key is the `.pem` downloaded for *this* instance, with `chmod 400`.
- **`curl http://LINUXONE_IP:8000` times out but `ssh` works**: something blocks inbound traffic. On the VM check `sudo ufw status` (the script opens 80 and 443 if `ufw` is active). If the Community Cloud itself blocks the port, ask the organizers; a laptop-only fallback is an SSH tunnel, `ssh -i ~/.ssh/medvault.pem -L 8000:127.0.0.1:8000 linux1@LINUXONE_IP`, then http://localhost:8000 on the laptop (phones cannot use this).
- **`linuxone_https.sh` ends with "Not reachable yet"**: `sudo journalctl -u caddy -n 50`. Usually ports 80/443 are not reachable from the internet, or Let's Encrypt rate-limited the name. Fallback: add `tls internal` as the first line inside the site block of `/etc/caddy/Caddyfile`, then `sudo systemctl restart caddy`; phones show a certificate warning once and then work.
- **Sign-in does nothing on `http://LINUXONE_IP:8000` after step 7**: production mode sets Secure cookies, and the app now listens on localhost only. Use the `https://` URL.
- **`make run` says the address is in use**: the `medvault` service owns port 8000 now; use `sudo systemctl restart medvault`.
- **`apt` is slow**: s390x packages come from `ports.ubuntu.com`; the first `apt-get update` can take a few minutes.
- **Off-hours rule fires at odd times**: the rules judge time in `MEDVAULT_TIMEZONE` (America/Chicago), not the VM clock, so this is expected to match Dallas.

import pexpect
import sys
import os

domain = "bts-mapa-novy.surge.sh"
print(f"Deploying to {domain}...")

child = pexpect.spawn(f'npx --yes surge ./ {domain}', encoding='utf-8')

# Interact with surge CLI login prompts
index = child.expect(['email:', 'Login:', pexpect.EOF, pexpect.TIMEOUT], timeout=30)

if index == 0 or index == 1:
    child.sendline('sydloch.btsmapa@gmail.com')
    child.expect('password:')
    child.sendline('BtsMapa123!O2')
else:
    print(child.before)
    sys.exit(0)

# Wait for deployment to finish
child.expect(pexpect.EOF, timeout=120)
print(child.before)

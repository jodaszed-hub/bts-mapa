import pexpect
import sys

child = pexpect.spawn('npx --yes surge ./ bts-mapa-o2.surge.sh', encoding='utf-8')

# Check what happens
index = child.expect(['email:', 'Login:', pexpect.EOF, pexpect.TIMEOUT], timeout=30)

if index == 0 or index == 1:
    child.sendline('sydloch.btsmapa@gmail.com')
    child.expect('password:')
    child.sendline('BtsMapa123!O2')
else:
    print(child.before)
    sys.exit(0)

# Interakce dál
child.expect(pexpect.EOF, timeout=120)
print(child.before)

"""Loopback-only synthetic SMTP test; run only in the disposable jail script."""
import asyncio
import errno
import os
import socket
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from mail_capture import MailCapture


class IsolatedLoopback(unittest.IsolatedAsyncioTestCase):
    async def test_capture_loopback_and_teardown(self):
        self.assertNotEqual(os.getuid(),0)
        with open('/proc/self/status',encoding='ascii') as f: status=f.read()
        for key in ['CapEff','CapBnd']:
            self.assertRegex(status,rf'(?m)^{key}:\s+0+$')
        self.assertEqual({name for _,name in socket.if_nameindex()},{'lo'})
        for path in ['/home/user','/run/user','/work/.git']:
            self.assertFalse(os.path.exists(path))
        for key in ['AWS_SECRET_ACCESS_KEY','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY']:
            self.assertNotIn(key,os.environ)
        outside=socket.socket();outside.settimeout(1)
        try:
            with self.assertRaises(OSError) as failed:outside.connect(('1.1.1.1',80))
            self.assertEqual(failed.exception.errno,errno.ENETUNREACH)
        finally:outside.close()
        self.assertFalse(subprocess.check_output(['ss','-H','-lnt'],text=True).strip())
        capture=MailCapture();tasks=set()
        def accept(reader,writer):
            task=asyncio.create_task(capture.handle(reader,writer));tasks.add(task);task.add_done_callback(tasks.discard)
        server=await asyncio.start_server(accept,host='127.0.0.1',port=0,limit=4097)
        host,port=server.sockets[0].getsockname();self.assertEqual(host,'127.0.0.1')
        listeners=subprocess.check_output(['ss','-H','-lnt'],text=True).splitlines()
        self.assertEqual(len(listeners),1);self.assertRegex(listeners[0],rf'\s127\.0\.0\.1:{port}\s')
        reader,writer=await asyncio.open_connection('127.0.0.1',port)
        try:
            self.assertTrue((await reader.readline()).startswith(b'220'))
            async def send(line):
                writer.write(line+b'\r\n');await writer.drain();return await reader.readline()
            self.assertTrue((await send(b'EHLO localhost')).startswith(b'250-'));await reader.readline()
            self.assertTrue((await send(b'MAIL FROM:<system@example.test>')).startswith(b'250'))
            self.assertTrue((await send(b'RCPT TO:<alice@example.test>')).startswith(b'250'))
            self.assertTrue((await send(b'DATA')).startswith(b'354'))
            writer.write(b'Subject: synthetic\r\n\r\nplaceholder\r\n.\r\n');await writer.drain()
            self.assertTrue((await reader.readline()).startswith(b'250'))
            self.assertIn(b'placeholder',capture.pop_for('alice@example.test'))
            self.assertTrue((await send(b'QUIT')).startswith(b'221'))
        finally:
            writer.close();await writer.wait_closed();server.close();await server.wait_closed()
            if tasks:await asyncio.gather(*tasks)
            capture.clear()
        self.assertFalse(subprocess.check_output(['ss','-H','-lnt'],text=True).strip())
        with self.assertRaises(OSError):
            await asyncio.open_connection('127.0.0.1',port)

if __name__=='__main__':unittest.main()

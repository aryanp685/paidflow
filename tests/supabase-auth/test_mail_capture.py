"""Synthetic socketpair tests. No real provider, SMTP listener or mail account."""
import asyncio
from email.message import EmailMessage
import os
import socket
import sys
import unittest
from urllib.parse import urlencode

sys.path.insert(0, os.path.dirname(__file__))
from mail_capture import MailCapture, verification_link


def message(link):
    mail=EmailMessage();mail['From']='no-reply@example.test';mail['To']='alice@example.test'
    mail.set_content(f'<p><a href="{link}">Confirm</a></p>',subtype='html')
    return mail.as_bytes()


def link(host='127.0.0.1',port=9999,callback='http://127.0.0.1:3000/auth/callback',kind='recovery',extra=''):
    return f'http://{host}:{port}/verify?'+urlencode({'token':'synthetic-token','type':kind,'redirect_to':callback})+extra


class LinkTests(unittest.TestCase):
    def test_synthetic_mime_and_html_escape(self):
        url=link(); self.assertEqual(verification_link(message(url.replace('&','&amp;')),9999,3000),url)
    def test_reject_external_userinfo_redirect_and_port(self):
        for url in [link('example.com'),link('127.0.0.1',9998),link('attacker@127.0.0.1'),link(callback='http://example.com/auth/callback'),link(callback='http://127.0.0.1:3000/other'),link(kind='magiclink'),link(extra='&token=second')]:
            with self.subTest(url=url),self.assertRaises(ValueError): verification_link(message(url.replace('&','&amp;')),9999,3000)
    def test_reject_duplicate_links_missing_or_empty_token(self):
        m=EmailMessage();m.set_content('<a href="x">x</a><a href="y">y</a>',subtype='html')
        for data in [m.as_bytes(),b'Subject: no link\r\n\r\nhello',message(link().replace('synthetic-token',''))]:
            with self.assertRaises(ValueError): verification_link(data,9999,3000)
    def test_reject_invalid_ports_and_fragments(self):
        for url,port in [(link()+'#fragment',9999),(link(),0),(link(),True)]:
            with self.assertRaises(ValueError): verification_link(message(url.replace('&','&amp;')),port,3000)


class SMTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.capture=MailCapture();client,server=socket.socketpair();client.setblocking(False);server.setblocking(False)
        self.reader,self.writer=await asyncio.open_connection(sock=client,limit=4097)
        sr,sw=await asyncio.open_connection(sock=server,limit=4097)
        self.task=asyncio.create_task(self.capture.handle(sr,sw))
        self.assertTrue((await self.reader.readline()).startswith(b'220'))
    async def asyncTearDown(self):
        self.writer.close();await self.writer.wait_closed();await asyncio.wait_for(self.task,2);self.capture.clear()
    async def command(self,command):
        self.writer.write(command+b'\r\n');await self.writer.drain();return await asyncio.wait_for(self.reader.readline(),2)
    async def hello(self):
        self.assertTrue((await self.command(b'EHLO local')).startswith(b'250-'));self.assertTrue((await self.reader.readline()).startswith(b'250 '))
    async def envelope(self):
        await self.hello();self.assertTrue((await self.command(b'MAIL FROM:<no-reply@example.test>')).startswith(b'250'));self.assertTrue((await self.command(b'RCPT TO:<alice@example.test>')).startswith(b'250'))
    async def test_capture_synthetic_message_and_dot_unstuff(self):
        await self.envelope();self.assertTrue((await self.command(b'DATA')).startswith(b'354'))
        body=message(link().replace('&','&amp;')).replace(b'\n',b'\r\n')+b'..dots\r\n.\r\n';self.writer.write(body);await self.writer.drain();self.assertTrue((await self.reader.readline()).startswith(b'250'))
        result=self.capture.pop_for('alice@example.test');self.assertIn(b'.dots\r\n',result);self.assertEqual(verification_link(result,9999,3000),link())
        with self.assertRaises(LookupError):self.capture.pop_for('alice@example.test')
    async def test_real_addresses_and_multiple_recipients_rejected(self):
        await self.hello();self.assertTrue((await self.command(b'MAIL FROM:<real@example.com>')).startswith(b'550'))
        self.assertTrue((await self.command(b'MAIL FROM:<no-reply@example.test>')).startswith(b'250'))
        self.assertTrue((await self.command(b'RCPT TO:<real@example.com>')).startswith(b'550'))
        self.assertTrue((await self.command(b'RCPT TO:<alice@example.test>')).startswith(b'250'))
        self.assertTrue((await self.command(b'RCPT TO:<bob@example.test>')).startswith(b'503'))
    async def test_requires_valid_smtp_sequence_and_no_tls(self):
        self.assertTrue((await self.command(b'DATA')).startswith(b'503'));await self.hello()
        self.assertTrue((await self.command(b'STARTTLS')).startswith(b'503'));self.assertTrue((await self.command(b'AUTH PLAIN password')).startswith(b'503'))
        self.assertTrue((await self.command(b'QUIT')).startswith(b'221'))
    async def test_helo_and_reset_clear_envelope(self):
        self.assertTrue((await self.command(b'HELO local')).startswith(b'250 '))
        self.assertTrue((await self.command(b'MAIL FROM:<no-reply@example.test>')).startswith(b'250'))
        self.assertTrue((await self.command(b'RCPT TO:<alice@example.test>')).startswith(b'250'))
        self.assertTrue((await self.command(b'RSET')).startswith(b'250'))
        self.assertTrue((await self.command(b'DATA')).startswith(b'503'))
    async def test_oversize_message_discarded(self):
        await self.envelope();await self.command(b'DATA');self.writer.write((b'x'*1000+b'\r\n')*66+b'.\r\n');await self.writer.drain()
        self.assertTrue((await self.reader.readline()).startswith(b'552'))
        with self.assertRaises(LookupError):self.capture.pop_for('alice@example.test')
    async def test_full_queue_and_invalid_lookup(self):
        self.capture._messages=[('alice@example.test',b'x')]*32
        await self.envelope();await self.command(b'DATA');self.writer.write(b'message\r\n.\r\n');await self.writer.drain();self.assertTrue((await self.reader.readline()).startswith(b'452'))
        for address in ['outside@example.com','alice@example.test\u2603']:
            with self.assertRaises(ValueError):self.capture.pop_for(address)
    async def test_connection_limit_rejects_before_greeting(self):
        self.capture._active=8;client,server=socket.socketpair();client.setblocking(False);server.setblocking(False)
        reader,writer=await asyncio.open_connection(sock=client);sr,sw=await asyncio.open_connection(sock=server)
        task=asyncio.create_task(self.capture.handle(sr,sw));self.assertTrue((await reader.readline()).startswith(b'421'));writer.close();await writer.wait_closed();await task;self.capture._active=1

if __name__=='__main__':unittest.main()

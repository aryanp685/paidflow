"""Synthetic in-memory SMTP peer for a future isolated provider harness.

This module never binds a listener by itself and never forwards or logs mail. A
caller must supply streams from a listener inside an independently checked,
credential-free network namespace. It is not a production SMTP service.
"""
import asyncio
import email
from email import policy
from html.parser import HTMLParser
import re
from urllib.parse import parse_qsl, urlsplit

MAX_MESSAGE = 65_536
MAX_LINE = 4_096
MAX_MESSAGES = 32
MAX_COMMANDS = 128
MAX_CONNECTIONS = 8
TIMEOUT_SECONDS = 10
ADDRESS = re.compile(rb"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.test", re.I)


def _envelope(value, prefix):
    # No raw request text is returned or logged on rejection.
    match = re.fullmatch(prefix + rb":\s*<([^<>]*)>(?:\s+SIZE=\d+)?", value, re.I)
    if not match or not ADDRESS.fullmatch(match.group(1)) or len(match.group(1)) > 254:
        return None
    return match.group(1).lower().decode('ascii')


class MailCapture:
    def __init__(self):
        self._messages = []
        self._active = 0

    def pop_for(self, address):
        if not isinstance(address, str) or not address.isascii() or not ADDRESS.fullmatch(address.encode('ascii')):
            raise ValueError('invalid synthetic address')
        for index, (recipient, body) in enumerate(self._messages):
            if recipient == address.lower():
                return self._messages.pop(index)[1]
        raise LookupError('synthetic message not found')

    def clear(self):
        self._messages.clear()

    async def handle(self, reader, writer):
        if self._active >= MAX_CONNECTIONS:
            try:
                await self._reply(writer, b'421 capture busy\r\n')
            except ConnectionError:
                pass
            finally:
                writer.close()
                try:
                    await writer.wait_closed()
                except (ConnectionError, BrokenPipeError):
                    pass
            return
        self._active += 1
        sender = None
        recipient = None
        greeted = False
        try:
            await self._reply(writer, b'220 synthetic mail capture\r\n')
            for _ in range(MAX_COMMANDS):
                line = await asyncio.wait_for(reader.readline(), TIMEOUT_SECONDS)
                if not line or len(line) > MAX_LINE or not line.endswith(b'\r\n'):
                    break
                command, _, arg = line[:-2].partition(b' ')
                command = command.upper()
                if command in (b'EHLO', b'HELO') and arg:
                    greeted = True; sender = None; recipient = None
                    await self._reply(writer, b'250-synthetic\r\n250 SIZE 65536\r\n' if command == b'EHLO' else b'250 synthetic\r\n')
                elif command == b'MAIL' and greeted:
                    sender = _envelope(arg, b'FROM'); recipient = None
                    await self._reply(writer, b'250 OK\r\n' if sender else b'550 synthetic addresses only\r\n')
                elif command == b'RCPT' and sender and not recipient:
                    recipient = _envelope(arg, b'TO')
                    await self._reply(writer, b'250 OK\r\n' if recipient else b'550 synthetic addresses only\r\n')
                elif command == b'DATA' and sender and recipient and not arg:
                    await self._reply(writer, b'354 End with dot\r\n')
                    body = bytearray()
                    while True:
                        part = await asyncio.wait_for(reader.readline(), TIMEOUT_SECONDS)
                        if not part or len(part) > MAX_LINE or not part.endswith(b'\r\n'):
                            return
                        if part == b'.\r\n':
                            break
                        if part.startswith(b'..'):
                            part = part[1:]
                        body.extend(part)
                        if len(body) > MAX_MESSAGE:
                            await self._reply(writer, b'552 message too large\r\n')
                            return
                    if len(self._messages) >= MAX_MESSAGES:
                        await self._reply(writer, b'452 capture full\r\n')
                    else:
                        self._messages.append((recipient, bytes(body)))
                        await self._reply(writer, b'250 captured\r\n')
                    sender = None; recipient = None
                elif command == b'RSET' and not arg:
                    sender = None; recipient = None
                    await self._reply(writer, b'250 OK\r\n')
                elif command == b'NOOP' and not arg:
                    await self._reply(writer, b'250 OK\r\n')
                elif command == b'QUIT' and not arg:
                    await self._reply(writer, b'221 closing\r\n')
                    return
                else:
                    await self._reply(writer, b'503 unsupported or invalid state\r\n')
        except (asyncio.TimeoutError, ConnectionError, ValueError, asyncio.LimitOverrunError):
            pass
        finally:
            self._active -= 1
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, BrokenPipeError):
                pass

    @staticmethod
    async def _reply(writer, data):
        writer.write(data)
        await writer.drain()


class _Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hrefs = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'a':
            self.hrefs.extend(value for name, value in attrs if name.lower() == 'href' and value is not None)


def _local_http(value, port):
    if not isinstance(value, str) or len(value) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('invalid URL')
    try:
        u = urlsplit(value)
        if u.scheme != 'http' or u.hostname != '127.0.0.1' or u.port != port or u.username is not None or u.password is not None or u.fragment:
            raise ValueError('URL must target the configured loopback listener')
        return u
    except ValueError:
        raise ValueError('invalid or non-loopback URL') from None


def verification_link(message, auth_port, callback_port):
    """Return one local verify URL; never fetch it or follow any redirect."""
    if not isinstance(message, bytes) or len(message) > MAX_MESSAGE:
        raise ValueError('invalid synthetic message')
    if any(not isinstance(p, int) or isinstance(p, bool) or not 1 <= p <= 65535 for p in (auth_port, callback_port)):
        raise ValueError('invalid port')
    parsed = email.message_from_bytes(message, policy=policy.default)
    links = _Links()
    for part in parsed.walk():
        if part.get_content_type() == 'text/html' and not part.is_multipart():
            try:
                links.feed(part.get_content())
            except (LookupError, UnicodeError, TypeError):
                raise ValueError('invalid mail content') from None
    if len(links.hrefs) != 1:
        raise ValueError('expected exactly one verification link')
    url = links.hrefs[0]
    u = _local_http(url, auth_port)
    if u.path != '/verify':
        raise ValueError('unexpected verification path')
    try:
        items = parse_qsl(u.query, keep_blank_values=True, strict_parsing=True, max_num_fields=8)
    except ValueError:
        raise ValueError('invalid verification query') from None
    keys = [key for key, _ in items]
    if len(keys) != len(set(keys)) or set(keys) != {'token', 'type', 'redirect_to'}:
        raise ValueError('unexpected verification query')
    values = dict(items)
    if not values['token'] or values['type'] not in {'recovery', 'signup'}:
        raise ValueError('invalid verification query')
    callback = _local_http(values['redirect_to'], callback_port)
    if callback.path != '/auth/callback':
        raise ValueError('unexpected callback path')
    return url

"""The `Notifier` port (technical/01 §4) and the local console adapter (08 §3).

The real outbox, SES and WhatsApp adapters are TASKS Amarsh 5; OTP delivery rides on
this port from day one so the customer sign-in flow has somewhere to send to.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal, Protocol

log = logging.getLogger("homeflow.notify")

Channel = Literal["email", "whatsapp", "sms", "console"]


@dataclass(frozen=True)
class OutboundMessage:
    channel: Channel
    to_address: str
    template_code: str
    vars: dict[str, str]
    subject: str | None = None


@dataclass(frozen=True)
class ProviderResult:
    provider_message_id: str
    status: Literal["sent", "failed", "suppressed"]
    error: str | None = None


class Notifier(Protocol):
    async def send(self, msg: OutboundMessage) -> ProviderResult: ...


class ConsoleNotifier:
    """Logs the message. Local default; also the fallback until a provider is chosen."""

    async def send(self, msg: OutboundMessage) -> ProviderResult:
        log.info(
            "notify[%s] to=%s template=%s vars=%s",
            msg.channel, msg.to_address, msg.template_code, msg.vars,
        )
        return ProviderResult(provider_message_id=f"console:{msg.template_code}", status="sent")


# ponytail: one process-wide instance until settings pick an adapter (Amarsh 5 adds
# SesEmail/Messaging and an `outbox` row per send).
notifier: Notifier = ConsoleNotifier()

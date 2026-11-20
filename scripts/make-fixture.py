"""Builds a synthetic Discord data package for local testing.

Usage: python scripts/make-fixture.py [out.zip] [message_count]
"""
import io
import json
import random
import sys
import zipfile
from datetime import datetime, timezone

EPOCH = 1420070400000
ME = "123456789012345678"
DELETED = "456226577798135808"
random.seed(7)


def snowflake(ms):
    return str((ms - EPOCH) << 22 | random.randint(0, 4095))


def ts_for(sf):
    ms = (int(sf) >> 22) + EPOCH
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "test-fixtures/package.zip"
    total = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
    friends = [
        {"id": str(200000000000000000 + i), "username": f"friend{i}", "global_name": f"Friend {i}", "discriminator": "0", "avatar": None}
        for i in range(8)
    ]
    user = {
        "id": ME, "username": "tester", "global_name": "Test User", "discriminator": "0", "avatar_hash": None,
        "relationships": [{"id": f["id"], "type": 1, "nickname": None, "user": f} for f in friends],
        "notes": {friends[0]["id"]: "met at the game jam"},
    }

    start = 1577836800000  # 2020-01-01
    end = 1735689600000  # 2025-01-01
    channels = []
    index = {}
    guilds = {"300000000000000001": "Pixel Art Club", "300000000000000002": "Rust Learners"}
    for i, f in enumerate(friends[:6]):
        cid = snowflake(start + i * 86400000 * 30)
        channels.append({"id": cid, "type": 1, "recipients": [ME, f["id"]]})
        index[cid] = f"Direct Message with {f['username']}#0"
    # A DM with a deleted user and a duplicate DM.
    cid = snowflake(start + 400 * 86400000)
    channels.append({"id": cid, "type": 1, "recipients": [ME, "Deleted User"]})
    index[cid] = "Direct Message with Deleted User#0000"
    cid = snowflake(start + 500 * 86400000)
    channels.append({"id": cid, "type": 1, "recipients": [ME, friends[0]["id"]]})
    index[cid] = f"Direct Message with {friends[0]['username']}#0"
    cid = snowflake(start + 10 * 86400000)
    channels.append({"id": cid, "type": 3, "name": "weekend plans", "recipients": [ME, friends[1]["id"], friends[2]["id"]]})
    index[cid] = "weekend plans"
    for gid, gname in guilds.items():
        for name in ("general", "showcase"):
            cid = snowflake(start + random.randint(0, 900) * 86400000)
            channels.append({"id": cid, "type": 0, "name": name, "guild": {"id": gid, "name": gname}})
            index[cid] = f"{name} in {gname}"

    words = "hello pixel rust borrow checker lunch tomorrow cat picture sprite palette shader compile error weekend game jam".split()
    img_urls = [f"https://cdn.discordapp.com/embed/avatars/{n}.png" for n in range(6)]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("account/user.json", json.dumps(user))
        z.writestr("messages/index.json", json.dumps(index))
        z.writestr("servers/index.json", json.dumps(guilds))
        per = max(1, total // len(channels))
        for ci, ch in enumerate(channels):
            msgs = []
            for _ in range(per):
                sf = snowflake(random.randint(max(start, (int(ch["id"]) >> 22) + EPOCH), end))
                content = " ".join(random.choice(words) for _ in range(random.randint(1, 12)))
                r = random.random()
                if r < 0.03:
                    content += " <:blobwave:396521773144866826>"
                elif r < 0.05:
                    content += f" <@{friends[1]['id']}> check https://example.com/page"
                atts = ""
                r = random.random()
                if r < 0.06:
                    atts = random.choice(img_urls)
                elif r < 0.08:
                    atts = f"https://cdn.discordapp.com/attachments/{ch['id']}/{sf}/old_photo.png"
                elif r < 0.09:
                    atts = f"https://cdn.discordapp.com/attachments/{ch['id']}/{sf}/notes.txt?ex=65000000&is=64000000&hm=abc"
                msgs.append({"ID": sf, "Timestamp": ts_for(sf), "Contents": content, "Attachments": atts})
            folder = f"messages/c{ch['id']}"
            z.writestr(f"{folder}/channel.json", json.dumps(ch))
            if ci % 3 == 0:
                # Old CSV format, including a quoted field with comma, quote and newline.
                lines = ["ID,Timestamp,Contents,Attachments"]
                msgs.append({"ID": snowflake(end - 1000), "Timestamp": "x", "Contents": 'multi\nline, "quoted" text', "Attachments": ""})
                for m in msgs:
                    c = m["Contents"].replace('"', '""')
                    lines.append(f'{m["ID"]},{m["Timestamp"]},"{c}",{m["Attachments"]}')
                z.writestr(f"{folder}/messages.csv", "\n".join(lines))
            else:
                z.writestr(f"{folder}/messages.json", json.dumps(msgs))

        events = [
            {"event_type": "register", "timestamp": '"2019-05-01T10:00:00.000Z"'},
            {"event_type": "guild_joined", "guild_id": "300000000000000001", "join_type": "invite", "join_method": "instant_invite", "invite_code": "pixels", "timestamp": '"2020-02-01T10:00:00.000Z"'},
            {"event_type": "accepted_instant_invite", "guild": "300000000000000002", "invite": "rusty", "timestamp": '"2021-03-01T10:00:00.000Z"'},
            {"event_type": "create_guild", "guild_id": "300000000000000003", "timestamp": '"2022-04-01T10:00:00.000Z"'},
            {"event_type": "app_opened", "timestamp": '"2023-01-01T10:00:00.000Z"'},
        ]
        body = "\n".join(json.dumps(e, separators=(",", ":")) for e in events)
        z.writestr("activity/analytics/events-2025-00000-of-00001.json", body)
        z.writestr("activity/reporting/events-2025-00000-of-00001.json", body)

    import os
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "wb") as f:
        f.write(buf.getvalue())
    print(f"wrote {out} ({len(buf.getvalue()) // 1024} KB, ~{per * len(channels)} messages)")


if __name__ == "__main__":
    main()

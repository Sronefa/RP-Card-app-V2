"""Builds the card fixtures with Pillow and zipfile, independently of CardForge's own PNG code.

Run from this folder: python3 make_fixtures.py
"""
import base64
import json
import zipfile
from io import BytesIO

from PIL import Image, PngImagePlugin

V2 = {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
        "name": "Seraphina",
        "description": "{{char}} is a guardian of the Eldoria forest. Ünïcödé ✨ test.",
        "personality": "Kind, protective",
        "scenario": "{{user}} wakes up in her glade.",
        "first_mes": "*Seraphina kneels beside you.* Are you hurt?",
        "mes_example": "<START>\n{{user}}: Hi\n{{char}}: Hello, traveller.",
        "creator_notes": "Test card",
        "system_prompt": "",
        "post_history_instructions": "",
        "alternate_greetings": ["*She hums softly.*"],
        "tags": ["fantasy", "guardian"],
        "creator": "tester",
        "character_version": "1.0",
        "extensions": {"talkativeness": "0.5", "fav": False, "world": "", "depth_prompt": {"prompt": "", "depth": 4, "role": "system"}},
        "character_book": {
            "name": "Eldoria",
            "extensions": {},
            "entries": [
                {
                    "id": 0,
                    "keys": ["Eldoria", "forest"],
                    "secondary_keys": [],
                    "comment": "The forest",
                    "content": "Eldoria is an ancient magical forest.",
                    "constant": False,
                    "selective": True,
                    "insertion_order": 100,
                    "enabled": True,
                    "position": "before_char",
                    "use_regex": True,
                    "extensions": {"position": 0, "depth": 4, "probability": 100, "useProbability": True, "selectiveLogic": 0, "display_index": 0},
                }
            ],
        },
    },
}
# SillyTavern also writes V1 fields at the top level of the chara chunk.
V2_WITH_V1 = {**{k: V2["data"][k] for k in ["name", "description", "personality", "scenario", "first_mes", "mes_example"]}, **V2}

V3 = {
    "spec": "chara_card_v3",
    "spec_version": "3.0",
    "data": {
        **V2["data"],
        "nickname": "Sera",
        "group_only_greetings": ["*Seraphina nods to the group.*"],
        "creation_date": 1700000000,
        "modification_date": 1700000500,
        "source": ["https://example.com/seraphina"],
        "assets": [
            {"type": "icon", "uri": "ccdefault:", "name": "main", "ext": "png"},
            {"type": "emotion", "uri": "__asset:1", "name": "happy", "ext": "png"},
        ],
    },
}


def b64(obj):
    return base64.b64encode(json.dumps(obj, ensure_ascii=False).encode("utf-8")).decode("ascii")


def image(color):
    buf = BytesIO()
    Image.new("RGB", (8, 12), color).save(buf, "PNG")
    return buf.getvalue()


def png_with(texts, color=(120, 80, 200)):
    info = PngImagePlugin.PngInfo()
    for k, v in texts:
        info.add_text(k, v)
    buf = BytesIO()
    Image.new("RGB", (8, 12), color).save(buf, "PNG", pnginfo=info)
    return buf.getvalue()


happy = image((250, 200, 0))

open("st-v2.png", "wb").write(png_with([("chara", b64(V2_WITH_V1))]))
open("st-v3.png", "wb").write(
    png_with([("chara", b64(V2_WITH_V1)), ("ccv3", b64(V3)), ("chara-ext-asset_:1", base64.b64encode(happy).decode())])
)
open("plain.png", "wb").write(png_with([]))

charx_card = json.loads(json.dumps(V3))
charx_card["data"]["assets"] = [
    {"type": "icon", "uri": "embeded://assets/icon/images/main.png", "name": "main", "ext": "png"},
    {"type": "emotion", "uri": "embeded://assets/emotion/images/happy.png", "name": "happy", "ext": "png"},
    {"type": "background", "uri": "https://example.com/bg.webp", "name": "main", "ext": "webp"},
]
with zipfile.ZipFile("card.charx", "w") as z:
    z.writestr("card.json", json.dumps(charx_card, ensure_ascii=False))
    z.writestr("assets/icon/images/main.png", image((10, 120, 200)))
    z.writestr("assets/emotion/images/happy.png", happy)
    z.writestr("module.risum", b"ignored")

# RisuAI-style: CHARX appended to a JPEG.
jpg = BytesIO()
Image.new("RGB", (8, 12), (0, 0, 0)).save(jpg, "JPEG")
open("card.jpeg", "wb").write(jpg.getvalue() + open("card.charx", "rb").read())

json.dump(
    {
        "name": "Old Bot",
        "description": "A V1 card",
        "personality": "grumpy",
        "scenario": "a bar",
        "first_mes": "What do you want?",
        "mes_example": "",
    },
    open("v1.json", "w"),
)
json.dump(
    {"char_name": "Pyg", "char_persona": "Pygmalion persona", "world_scenario": "space", "char_greeting": "Hey", "example_dialogue": "..."},
    open("pygmalion.json", "w"),
)

# SillyTavern World Info export, as written by ST 1.12+.
json.dump(
    {
        "entries": {
            "0": {
                "uid": 0, "key": ["dragon", "wyrm"], "keysecondary": ["fire"], "comment": "Dragons",
                "content": "Dragons rule the northern peaks.", "constant": False, "vectorized": False,
                "selective": True, "selectiveLogic": 3, "addMemo": True, "order": 100, "position": 4,
                "disable": False, "excludeRecursion": False, "preventRecursion": True, "delayUntilRecursion": False,
                "probability": 80, "useProbability": True, "depth": 2, "group": "beasts", "groupOverride": False,
                "groupWeight": 100, "scanDepth": None, "caseSensitive": None, "matchWholeWords": None,
                "useGroupScoring": None, "automationId": "", "role": 0, "sticky": 2, "cooldown": None, "delay": None,
                "displayIndex": 1,
            },
            "1": {
                "uid": 1, "key": ["/king(dom)?/i"], "keysecondary": [], "comment": "Kingdom",
                "content": "The kingdom of Vael.", "constant": True, "vectorized": False, "selective": False,
                "selectiveLogic": 0, "addMemo": True, "order": 50, "position": 1, "disable": True,
                "excludeRecursion": False, "preventRecursion": False, "delayUntilRecursion": False, "probability": 100,
                "useProbability": True, "depth": 4, "group": "", "groupOverride": False, "groupWeight": 100,
                "scanDepth": None, "caseSensitive": True, "matchWholeWords": None, "useGroupScoring": None,
                "automationId": "", "role": None, "sticky": 0, "cooldown": 0, "delay": 0, "displayIndex": 0,
            },
        }
    },
    open("st-world-info.json", "w"),
    indent=2,
)

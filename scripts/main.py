import requests
import json
import os
import time
from datetime import datetime, timezone

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
WEBHOOK_KEY =  os.getenv("WEBHOOK_KEY")
REPO_OWNER = "bittu5134"
REPO_NAME = "gh-follow-tracker"

URL_GQL = "https://api.github.com/graphql"
URL_API = "https://api.github.com"
URL_WORKER = "https://follow.lazybittu.workers.dev/api/v1"
HEADERS = {"Authorization": f"Bearer {GITHUB_TOKEN}"}

def diskJson(path, data=None, indent=None):
    """
    Reads or writes JSON data to a file.
    - If 'data' is provided: Writes data to the path.
    - If 'data' is None: Reads data from the path.
    """
    if data is not None:
        (
            os.makedirs(os.path.dirname(path), exist_ok=True)
            if os.path.dirname(path)
            else None
        )
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=indent, ensure_ascii=False)
        return True
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def fetchAllStars(owner, name):
    query = """
    query($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
        stargazers(first: 100, after: $cursor) {
        pageInfo {
            endCursor
            hasNextPage
        }
        edges {
            node {
            login
            createdAt
            databaseId
            followers {
                totalCount
            }
            }
        }
        }
    }
    }
    """
    stargazerList = dict()
    hasNextPage = True
    cursor = None

    print(f"Fetching stars for {owner}/{name}...")

    while hasNextPage:
        variables = {"owner": owner, "name": name, "cursor": cursor}
        response = requests.post(
            URL_GQL, json={"query": query, "variables": variables}, headers=HEADERS
        )

        if response.status_code != 200:
            raise Exception(f"Query failed: {response.status_code}\n{response.text}")

        responseJson = response.json()
        if "errors" in responseJson:
            print(json.dumps(responseJson["errors"], indent=2))
            break

        data = responseJson["data"]["repository"]["stargazers"]

        for edge in data["edges"]:
            user = edge["node"]
            stargazerList[user["login"].lower()] = {
                "id": user["databaseId"],
                "createdAt": user["createdAt"],
                "followers": user["followers"]["totalCount"],
            }

        hasNextPage = data["pageInfo"]["hasNextPage"]
        cursor = data["pageInfo"]["endCursor"]

        print(f"✅ Progress: {len(stargazerList)}")
    return stargazerList

def fetchFollowers(targetUser, targetId, storedData, token):
    isNewUser = not storedData
    if isNewUser:
        storedData = {"username": targetUser, "id": targetId, "data": []}

    oldFollowerMap = {}
    for pageObj in storedData.get("data", []):
        for f in pageObj["followers"]:
            oldFollowerMap[(f["username"], f["id"])] = f["timestamp"]

    currentFullList, pageEtags = [], {}
    page, perPage = 1, 100

    while True:
        url = f"{URL_API}/users/{targetUser}/followers?per_page={perPage}&page={page}"
        existingPage = next(
            (p for p in storedData["data"] if p["pageNo"] == page), None
        )

        headers = HEADERS.copy()
        headers["Authorization"] = f"Bearer {token}"
        if existingPage:
            headers["If-None-Match"] = existingPage["etag"]

        res = requests.get(url, headers=headers)

        if res.status_code == 304:
            print(f"  ☁️ Page {page}: Not Modified")
            pageData = [(f["username"], f["id"]) for f in existingPage["followers"]]
            pageEtags[page] = existingPage["etag"]
            currentFullList.extend(pageData)
        elif res.status_code == 200:
            print(f"  📥 Page {page}: New Data")
            pageData = [(u["login"].lower(), u["id"]) for u in res.json()]
            pageEtags[page] = res.headers.get("ETag")
            currentFullList.extend(pageData)
        else:
            break

        if "next" not in res.links:
            break
        page += 1

    currentSet = set(currentFullList)
    oldSet = set(oldFollowerMap.keys())
    gained = [n for n, u in (currentSet - oldSet)]
    lost = [n for n, u in (oldSet - currentSet)]

    if isNewUser: gained = lost = []

    nowTs = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    newData = []

    if not currentFullList:
        newData.append({"pageNo": 1, "etag": pageEtags.get(1), "followers": []})
    else:
        for i in range(0, len(currentFullList), perPage):
            pageNumber = (i // perPage) + 1
            chunk = currentFullList[i : i + perPage]
            pageFollowers = []

            for name, uid in chunk:
                userKey = (name, uid)
                ts = oldFollowerMap.get(userKey)

                if userKey not in oldFollowerMap and not isNewUser:
                    ts = nowTs

                pageFollowers.append({"id": uid, "username": name, "timestamp": ts})

            newData.append(
                {
                    "pageNo": pageNumber,
                    "etag": pageEtags.get(pageNumber),
                    "followers": pageFollowers,
                }
            )

    storedData["data"] = newData
    diskJson(f"./data/follower/{targetUser}.json", data=storedData)

    finalData = []
    for user in gained:
        finalData.append({"user": user, "id":storedData["id"], "gained": True})
    for user in lost:
        finalData.append({"user": user, "id":storedData["id"], "gained": False})

    return finalData

def trackUserHistory(username, userId, followerCount, createdAt, nowTs):
    path = f"./data/user/{username}.json"
    userData = diskJson(path) or {
        "username": username,
        "id": userId,
        "createdAt": createdAt,
        "firstTracked": nowTs,
        "history": [],
    }

    history = userData["history"]
    nowDate = nowTs[:10]

    if not history:
        history.append({"timestamp": nowTs, "followerCount": followerCount})
    else:
        lastEntry = history[-1]
        lastDate = lastEntry["timestamp"][:10]

        if lastDate == nowDate:
            lastEntry["followerCount"] = followerCount
            lastEntry["timestamp"] = nowTs
        elif followerCount != lastEntry["followerCount"]:
            history.append({"timestamp": nowTs, "followerCount": followerCount})
        else:
            return 

    diskJson(path, userData)

def getWebhooks(data :dict):
    url = f"{URL_WORKER}/all_webhooks"
    payload = {"passphrase": WEBHOOK_KEY}
    webhookMap = {}

    response: dict = requests.post(url, json=payload).json()

    for user in response:
        if data.get(user) != None:
            webhookMap[user] = response[user]

    return webhookMap

def postWebhook(username, dataSet, webhookSet):
    webhooks = webhookSet.get("webhooks", [])

    for data in dataSet:
        follower = data.get("user")
        gained = data.get("gained")

        description = (
            f"{username} gained a new Follower"
            if gained
            else f"{username} lost a Follower"
        )
        color_int = 3066993 if gained else 15158332
        hex_color = "#2eb886" if gained else "#a30200"
        user_url = f"https://github.com/{username}"
        follower_url = f"https://github.com/{follower}"

        for url in webhooks:
            payload = {}
            headers = {"Content-Type": "application/json"}

            try:
                # 1. DISCORD
                if "discord.com" in url:
                    payload = {
                        "embeds": [
                            {
                                "description": f"### [{description}]({user_url})",
                                "author": {
                                    "name": follower,
                                    "url": follower_url,
                                    "icon_url": f"{follower_url}.png",
                                },
                                "color": color_int,
                            }
                        ]
                    }

                elif "slack.com" in url:
                    payload = {
                        "text": f"{description}",
                        "blocks": [
                            {
                                "type": "context",
                                "elements": [
                                    {
                                        "type": "image",
                                        "image_url": f"{follower_url}.png",
                                        "alt_text": "avatar",
                                    },
                                    {
                                        "type": "mrkdwn",
                                        "text": f"*<{follower_url}|{follower}>*",
                                    },
                                ],
                            },
                            {
                                "type": "section",
                                "text": {
                                    "type": "mrkdwn",
                                    "text": f"*<{user_url}|{description}>*",
                                },
                            },
                        ],
                    }

                # 3. TELEGRAM (Assuming the URL is the bot's sendMessage endpoint)
                elif "telegram.org" in url:
                    payload = {
                        "text": f"<a href='{follower_url}'>{follower}</a> has started following <b><a href='{user_url}'>{username}</a></b>",
                        "parse_mode": "HTML",
                    }

                # 4. MICROSOFT TEAMS
                elif "office.com" in url or "webhook.office.com" in url:
                    payload = {
                        "type": "message",
                        "attachments": [
                            {
                                "contentType": "application/vnd.microsoft.card.adaptive",
                                "content": {
                                    "type": "AdaptiveCard",
                                    "version": "1.4",
                                    "body": [
                                        {
                                            "type": "ColumnSet",
                                            "columns": [
                                                {
                                                    "type": "Column",
                                                    "width": "auto",
                                                    "items": [
                                                        {
                                                            "type": "Image",
                                                            "url": f"{follower_url}.png",
                                                            "size": "Small",
                                                            "style": "Person",
                                                        }
                                                    ],
                                                },
                                                {
                                                    "type": "Column",
                                                    "width": "stretch",
                                                    "items": [
                                                        {
                                                            "type": "TextBlock",
                                                            "text": f"{description}",
                                                            "weight": "Bolder",
                                                            "size": "Medium",
                                                            "wrap": True,
                                                        },
                                                        {
                                                            "type": "TextBlock",
                                                            "text": f"Follower: [{follower}]({follower_url})",
                                                            "isSubtle": True,
                                                            "spacing": "None",
                                                            "wrap": True,
                                                        },
                                                    ],
                                                },
                                            ],
                                        }
                                    ],
                                    "actions": [
                                        {
                                            "type": "Action.OpenUrl",
                                            "title": "View Profile",
                                            "url": follower_url,
                                        }
                                    ],
                                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                                },
                            }
                        ],
                    }

                elif "api.github.com" in url:
                    token = webhookSet.get("token")

                    headers.update(
                        {
                            "Authorization": f"Bearer {token}",
                            "Accept": "application/vnd.github+json",
                        }
                    )

                    payload = {"event_type": "follow", "client_payload": data}

                # 6. RAW VERSION (Fallback)
                else:
                    payload = data

                # Execute Request
                response = requests.post(url, json=payload, headers=headers, timeout=5)
                response.raise_for_status()
                time.sleep(0.1)

            except Exception as e:
                print(f"Error posting to {url}: {e}")

nowTs = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
starList = fetchAllStars(REPO_OWNER, REPO_NAME)
oldStarList = diskJson("./data/stars.json") or {}
hasFollowerChange = {}

for username, value in starList.items():
    oldValue = oldStarList.get(username)

    if not oldValue:
        value["firstTracked"] = nowTs
        hasFollowerChange[username] = value
    else:
        value["firstTracked"] = oldValue.get("firstTracked", nowTs)
        if value["followers"] != oldValue["followers"]:
            hasFollowerChange[username] = value

diskJson("./data/stars.json", starList)
webhookDB = getWebhooks(hasFollowerChange)

for username, data in hasFollowerChange.items():
    print(f"🔍 Processing {username}...")
    trackUserHistory(username, data["id"], data["followers"], data["createdAt"], nowTs)


for username, data in hasFollowerChange.items():
    webhookData = webhookDB.get(username)
    if webhookData:
        print(f"🌟 Fetching Followers for {username}...")
        oldFollowerData = diskJson(f"./data/follower/{username}.json")
        followerChanges = fetchFollowers(username, data["id"], oldFollowerData, webhookData["token"])
        print(f"  📤 Sending Webhooks")
        postWebhook(username ,followerChanges, webhookData)
        time.sleep(0.5)

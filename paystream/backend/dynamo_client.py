import boto3
import os
from dotenv import load_dotenv

load_dotenv()

TABLE = os.getenv("DYNAMO_TABLE_RULES", "paystream-rules")
REGION = os.getenv("AWS_REGION", "ap-south-1")

# In-memory fallback — demo works even without DynamoDB
_rule_cache: dict[str, str] = {}

try:
    _dynamo = boto3.client("dynamodb", region_name=REGION)
    _dynamo_available = True
except Exception:
    _dynamo_available = False


def save_rule(merchant_id: str, rule_text: str) -> None:
    _rule_cache[merchant_id] = rule_text
    if not _dynamo_available:
        return
    try:
        _dynamo.put_item(
            TableName=TABLE,
            Item={
                "merchant_id": {"S": merchant_id},
                "rule_text": {"S": rule_text},
            },
        )
    except Exception as e:
        print(f"[DynamoDB] save_rule failed (using cache): {e}")


def get_rule_text(merchant_id: str) -> str:
    if merchant_id in _rule_cache:
        return _rule_cache[merchant_id]
    if not _dynamo_available:
        return "pause payment if charge rate drops below 20kW"
    try:
        resp = _dynamo.get_item(
            TableName=TABLE,
            Key={"merchant_id": {"S": merchant_id}},
        )
        text = resp["Item"]["rule_text"]["S"]
        _rule_cache[merchant_id] = text
        return text
    except Exception as e:
        print(f"[DynamoDB] get_rule_text failed (using cache): {e}")
        return _rule_cache.get(merchant_id, "pause payment if charge rate drops below 20kW")

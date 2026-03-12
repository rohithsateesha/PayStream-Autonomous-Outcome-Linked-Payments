"""
Run once at hackathon start to create DynamoDB rules table.
Usage: python infra/setup_aws.py
"""
import boto3
import os
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv()

region = os.getenv("AWS_REGION", "ap-south-1")
table_name = os.getenv("DYNAMO_TABLE_RULES", "paystream-rules")


def create_rules_table():
    client = boto3.client("dynamodb", region_name=region)
    try:
        client.create_table(
            TableName=table_name,
            KeySchema=[{"AttributeName": "merchant_id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "merchant_id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        print(f"[OK] Created DynamoDB table: {table_name}")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceInUseException":
            print(f"[SKIP] Table {table_name} already exists")
        else:
            print(f"[ERROR] {e}")
            raise


if __name__ == "__main__":
    create_rules_table()

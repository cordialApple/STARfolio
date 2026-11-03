import boto3


def handler(event, context):
    ec2 = boto3.client("ec2")
    pages = ec2.get_paginator("describe_instances").paginate(
        Filters=[
            {"Name": "tag:StarfolioDemo", "Values": [event["name"]]},
            {"Name": "tag:StarfolioTrial", "Values": [event["trial_id"]]},
            {
                "Name": "instance-state-name",
                "Values": ["pending", "running", "stopping", "stopped"],
            },
        ]
    )
    terminated = 0
    for page in pages:
        ids = [
            item["InstanceId"]
            for group in page["Reservations"]
            for item in group["Instances"]
        ]
        if ids:
            ec2.terminate_instances(InstanceIds=ids)
            terminated += len(ids)
    return {"terminated": terminated}

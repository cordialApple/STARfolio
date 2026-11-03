mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/test-role"
    }
  }
  mock_resource "aws_lambda_function" {
    defaults = {
      arn = "arn:aws:lambda:us-east-2:123456789012:function:test-deadline"
    }
  }
}

run "worker_lifecycle" {
  command = apply

  assert {
    condition     = aws_instance.worker.instance_initiated_shutdown_behavior == "terminate"
    error_message = "Shutdown must terminate GPU worker."
  }
  assert {
    condition     = aws_instance.worker.metadata_options[0].http_tokens == "required"
    error_message = "Worker must require IMDSv2."
  }
  assert {
    condition     = aws_instance.worker.root_block_device[0].encrypted && aws_instance.worker.root_block_device[0].delete_on_termination
    error_message = "Root volume must be encrypted and removed on termination."
  }
  assert {
    condition     = length(aws_security_group.worker.ingress) == 0
    error_message = "Worker must have no public inbound rules."
  }
  assert {
    condition     = jsondecode(aws_scheduler_schedule.deadline.target[0].input).trial_id == output.trial_id
    error_message = "Deadline must target this trial."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.deadline.policy).Statement[1].Condition.StringEquals["ec2:ResourceTag/StarfolioTrial"] == output.trial_id
    error_message = "Termination IAM must constrain trial tag."
  }
  assert {
    condition     = aws_instance.worker.tags.StarfolioTrial == output.trial_id
    error_message = "Worker must carry trial provenance."
  }
}

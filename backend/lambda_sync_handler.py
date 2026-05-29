"""
AWS Lambda handler for syncing biometric attendance records from datalake-biometric app.

Receives HMAC-signed attendance records, verifies them, and persists to DynamoDB.

Environment Variables:
  DYNAMODB_TABLE: Name of DynamoDB table to store records
  WORKERS_TABLE: Name of worker master table
"""

import json
import hmac
import hashlib
import time
from datetime import datetime
from typing import Dict, Any, Tuple
import boto3
import os

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['DYNAMODB_TABLE'])
workers_table = dynamodb.Table(os.environ.get('WORKERS_TABLE', 'biometric-workers'))


def verify_signature(
    worker_id: str,
    timestamp: int,
    latitude: float,
    longitude: float,
    confidence: float,
    device_id: str,
    provided_signature: str,
    secret_key: str = None
) -> bool:
    """
    Verify HMAC-SHA256 signature of attendance record.
    
    Matches the LivenessEngine.kt signature generation:
      HMAC-SHA256(workerId|timestamp|lat|lng|confidence|deviceId)
    """
    if secret_key is None:
        # In production, retrieve from AWS Secrets Manager
        secret_key = os.environ.get('ATTENDANCE_SECRET', 'default-key')
    
    # Reconstruct the signed data
    message = f"{worker_id}|{timestamp}|{latitude}|{longitude}|{confidence}|{device_id}"
    
    # Compute HMAC-SHA256
    computed_signature = hmac.new(
        secret_key.encode(),
        message.encode(),
        hashlib.sha256
    ).hexdigest()
    
    # Constant-time comparison
    return hmac.compare_digest(computed_signature, provided_signature)


def handler(event, context):
    """
    Lambda handler for attendance record sync.
    
    Expected POST body:
    {
        "records": [
            {
                "id": "unique-record-id",
                "workerId": "EMP001",
                "timestamp": 1704067200,
                "latitude": 28.7041,
                "longitude": 77.1025,
                "confidence": 0.95,
                "deviceId": "device-abc123",
                "signature": "hmac-hex-string"
            }
        ]
    }
    """
    try:
        # Parse request
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
        
        records = body.get('records', [])
        
        if not records:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'No records provided'})
            }
        
        # Process each record
        results = {
            'successful': [],
            'failed': [],
            'duplicates': []
        }
        
        for record in records:
            try:
                # Verify signature
                if not verify_signature(
                    record['workerId'],
                    record['timestamp'],
                    record['latitude'],
                    record['longitude'],
                    record['confidence'],
                    record['deviceId'],
                    record['signature']
                ):
                    results['failed'].append({
                        'id': record['id'],
                        'reason': 'Signature verification failed'
                    })
                    continue
                
                # Check for duplicates (idempotency)
                try:
                    existing = table.get_item(Key={'record_id': record['id']})
                    if 'Item' in existing:
                        results['duplicates'].append(record['id'])
                        continue
                except Exception:
                    pass
                
                # Store in DynamoDB
                table.put_item(
                    Item={
                        'record_id': record['id'],
                        'worker_id': record['workerId'],
                        'timestamp': record['timestamp'],
                        'latitude': record['latitude'],
                        'longitude': record['longitude'],
                        'confidence': record['confidence'],
                        'device_id': record['deviceId'],
                        'signature': record['signature'],
                        'received_at': int(time.time()),
                        'processed_at': datetime.utcnow().isoformat(),
                        'ttl': int(time.time()) + (90 * 24 * 60 * 60)  # 90 day TTL
                    }
                )
                
                results['successful'].append(record['id'])
                
                # Trigger worker hours calculation lambda
                _trigger_hours_calculation(record['workerId'], record['timestamp'])
                
            except Exception as e:
                results['failed'].append({
                    'id': record.get('id', 'unknown'),
                    'reason': str(e)
                })
        
        # Summary
        summary = {
            'total': len(records),
            'successful': len(results['successful']),
            'failed': len(results['failed']),
            'duplicates': len(results['duplicates'])
        }
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': f"Processed {summary['successful']}/{summary['total']} records",
                'summary': summary,
                'results': results
            })
        }
        
    except Exception as e:
        print(f"Error: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }


def _trigger_hours_calculation(worker_id: str, timestamp: int):
    """
    Trigger async Lambda to calculate daily/weekly hours for worker.
    (Optional - for production attendance reporting)
    """
    try:
        lambda_client = boto3.client('lambda')
        lambda_client.invoke(
            FunctionName=os.environ.get('HOURS_CALCULATOR_FUNCTION', 'biometric-calculate-hours'),
            InvocationType='Event',
            Payload=json.dumps({
                'workerId': worker_id,
                'timestamp': timestamp
            })
        )
    except Exception as e:
        print(f"Warning: Could not trigger hours calculation: {e}")

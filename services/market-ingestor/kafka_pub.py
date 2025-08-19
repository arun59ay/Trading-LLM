# kafka_pub.py
import json
import os
from kafka import KafkaProducer

_producer = None

def get_producer():
    global _producer
    if _producer:
        return _producer
    broker = os.getenv("KAFKA_BROKER", "redpanda:9092")
    _producer = KafkaProducer(
        bootstrap_servers=broker,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        linger_ms=50,
        acks="1",
    )
    return _producer

def publish(topic: str, msg: dict):
    get_producer().send(topic, msg)

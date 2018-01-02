FROM ches/kafka:0.10.2.0

# ADD prometheus-config.yml /usr/app/prometheus-config.yml
ADD kafka-0-8-2.yml /usr/app/kafka-0-8-2.yml
ADD jmx_prometheus_javaagent-0.6.jar /usr/app/jmx_prometheus_javaagent.jar

#!/usr/bin/env bash

# get source directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# get platform to determine IP address accordingly
PLATFORM=$(uname -s)
if [ "$PLATFORM" == "Darwin" ]; then
  IP=$(ipconfig getifaddr en0)
elif [ "$PLATFORM" == "Linux" ]; then
  IP=$(hostname -I)
else
  echo "Unsupported platform. Can not determine IP address on your system."
  exit 1
fi

IMAGE_TAG="m99coder-tpc/kafka:0.10.2.0"

case "$1" in

  # setup dependencies and config files
  setup)
    echo "Setting up dependencies and config files …"

    # jmx reporter
    wget -q https://repo1.maven.org/maven2/io/prometheus/jmx/jmx_prometheus_javaagent/0.6/jmx_prometheus_javaagent-0.6.jar -O $DIR/jmx_prometheus_javaagent-0.6.jar &> /dev/null
    if [ $? -eq 0 ]; then
      echo "  dependency \"jmx_prometheus_javaagent-0.6.jar\" was downloaded"
    else
      echo "  dependency \"jmx_prometheus_javaagent-0.6.jar\" could not be downloaded"
      exit 1
    fi

    # kafka configuration (used by prometheus)
    wget -q https://raw.githubusercontent.com/prometheus/jmx_exporter/master/example_configs/kafka-0-8-2.yml -O $DIR/kafka-0-8-2.yml &> /dev/null
    if [ $? -eq 0 ]; then
      echo "  config file \"kafka-0-8-2.yml\" was downloaded"
    else
      echo "  config file \"kafka-0-8-2.yml\" could not be downloaded"
      exit 1
    fi

    # prometheus.yml
    sed "s|\${IP}|$IP|" $DIR/prometheus.template.yml > $DIR/prometheus.yml
    if [ $? -eq 0 ]; then
      echo "  config file \"prometheus.yml\" was created"
    else
      echo "  config file \"prometheus.yml\" could not be created"
      exit 1
    fi

    # settings.json
    sed "s|\${IP}|$IP|" $DIR/settings.template.json > $DIR/settings.json
    if [ $? -eq 0 ]; then
      echo "  config file \"settings.json\" was created"
    else
      echo "  config file \"settings.json\" could not be created"
      exit 1
    fi

    ;;

  # build docker image
  build)
    echo "Building docker image …"

    docker build -t $IMAGE_TAG $DIR/. &> /dev/null
    if [ $? -eq 0 ]; then
      echo "  image \"$IMAGE_TAG\" built"
    else
      echo "  image \"$IMAGE_TAG\" could not be built"
      exit 1
    fi
    ;;

  # start services
  start)
    $0 stop
    $0 build
    echo "Starting services …"
    echo "  using IP $IP"

    # zookeeper
    docker run -d --name zookeeper -p 2181:2181 -p 2888:2888 -p 3888:3888 zookeeper:3.4 &> /dev/null
    if [ $? -eq 0 ]; then
      echo "  service \"zookeeper\" started"
    else
      echo "  service \"zookeeper\" could not be started"
      exit 1
    fi

    # kafka
    docker run -d --name kafka --env KAFKA_ADVERTISED_HOST_NAME=$IP --env ZOOKEEPER_IP=$IP --env "KAFKA_OPTS=-javaagent:/usr/app/jmx_prometheus_javaagent.jar=7071:/usr/app/kafka-0-8-2.yml" -p 9092:9092 -p 7203:7203 -p 7071:7071 $IMAGE_TAG &> /dev/null
    if [ $? -eq 0 ]; then
      echo "  service \"kafka\" started"
    else
      echo "  service \"kafka\" could not be started"
      exit 1
    fi

    # prometheus
    docker run -d --name prometheus -p 9090:9090 -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml prom/prometheus:v1.6.3 &> /dev/null
    if [ $? -eq 0 ]; then
      echo "  service \"prometheus\" started"
    else
      echo "  service \"prometheus\" could not be started"
      exit 1
    fi

    # grafana
    docker run -d --name grafana -p 3000:3000 grafana/grafana:4.3.1 &> /dev/null
    if [ $? -eq 0 ]; then
      echo "  service \"grafana\" started"
    else
      echo "  service \"grafana\" could not be started"
      exit 1
    fi

    # redis for snapshots (port 6379)
    docker run -d --name redis-snapshots -p 6379:6379 redis:3.2.9 &> /dev/null
    if [ $? -eq 0 ]; then
      echo "  service \"redis-snapshots\" started"
    else
      echo "  service \"redis-snapshots\" could not be started"
      exit 1
    fi

    # redis for events (port 6380)
    docker run -d --name redis-events -p 6380:6379 redis:3.2.9 &> /dev/null
    if [ $? -eq 0 ]; then
      echo "  service \"redis-events\" started"
    else
      echo "  service \"redis-events\" could not be started"
      exit 1
    fi

    ;;

  # stop services
  stop)
    echo "Stopping services …"
    services=( zookeeper kafka prometheus grafana redis-snapshots redis-events )
    for i in "${services[@]}"
    do
      # check if service is or was running
      docker ps -a -f name=$i | grep -w $i &> /dev/null
      if [ $? -eq 0 ]; then
        # stop service
        docker stop $i &> /dev/null
        if [ $? -eq 0 ]; then
          echo "  service \"$i\" stopped"
        else
          echo "  service \"$i\" could not be stopped"
          exit 1
        fi
      else
        echo "  service \"$i\" is not running"
      fi
    done
    $0 clean
    ;;

  # clean containers
  clean)
    echo "Cleaning containers …"
    services=( zookeeper kafka prometheus grafana redis-snapshots redis-events )
    for i in "${services[@]}"
    do
      # check if service is or was running
      docker ps -a -f name=$i | grep -w $i &> /dev/null
      if [ $? -eq 0 ]; then
        # remove container
        docker rm $i &> /dev/null
        if [ $? -eq 0 ]; then
          echo "  container \"$i\" removed"
        else
          echo "  container \"$i\" could not be removed"
          exit 1
        fi
      else
        echo "  container \"$i\" does not exist"
      fi
    done
    ;;

  # show status
  status)
    echo "Status …"
    echo "  using IP $IP"
    services=( zookeeper kafka prometheus grafana redis-snapshots redis-events )
    for i in "${services[@]}"
    do
      echo ""
      echo $i
      # check if service is running
      docker ps -a -f name=$i | grep -w $i &> /dev/null
      if [ $? -eq 0 ]; then
        echo "  ID: $(docker inspect --format '{{ .Id }}' $i)"
        echo "  Image: $(docker inspect --format '{{ .Config.Image }}' $i)"
        echo "  IP Address: $(docker inspect --format '{{ .NetworkSettings.IPAddress }}' $i)"
        echo "  Ports: $(docker inspect --format '{{ .NetworkSettings.Ports }}' $i)"
      else
        echo "  service is not running"
      fi
    done
    ;;

  # default
  *)
    echo "Usage: $0 {setup|build|start|stop|clean|status}"
    exit 1

esac

exit 0

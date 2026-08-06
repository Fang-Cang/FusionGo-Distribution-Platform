pipeline {
    // 指定运行在名为 'listify-test' 的 SSH 节点上
    agent { label 'listify-test' }

    environment {
        // 根据你指定的项目名
        COMPOSE_PROJECT_NAME = 'fusiongo-distribution-platform'
    }

    stages {
        stage('Checkout') {
            steps {
                // 在 SSH 服务器上拉取代码
                checkout scm
            }
        }

        stage('Prepare env') {
            steps {
                script {
                    // docker-compose.yml 声明了 env_file: - .env，若部署机未手动创建 .env，
                    // docker compose 会直接报错；这里兜底创建一个空 .env，
                    // 让容器使用 docker-compose.yml 中 environment 段的 sandbox 模拟默认值。
                    // 后续拿到 FCG 真实凭证后，只需在该目录写入 .env 即可覆盖默认值，无需改代码。
                    sh '''
                        if [ ! -f .env ]; then
                            touch .env
                            echo "[deploy] .env 不存在，已创建空文件；容器将使用 docker-compose.yml 内置的 sandbox 模拟兜底配置。"
                        else
                            echo "[deploy] 已检测到部署机 .env，其变量将覆盖 docker-compose.yml 默认值。"
                        fi
                    '''
                }
            }
        }

        stage('Deploy with Docker Compose') {
            steps {
                script {
                    echo "正在远程 SSH 服务器上执行部署..."

                    // 打印当前目录，方便排错
                    sh "pwd"
                    sh "ls -al"

                    // 使用你指定的 V2 版命令格式：docker compose (中间是空格)
                    sh "docker compose -p ${COMPOSE_PROJECT_NAME} down || true"
                    sh "docker compose -p ${COMPOSE_PROJECT_NAME} up -d --build"

                    // 部署后短暂等待服务启动，再输出健康检查结果便于定位
                    sh '''
                        sleep 5
                        echo "=== 容器状态 ==="
                        docker ps --filter name=fusiongo-app
                        echo "=== /api/health ==="
                        curl -s -o /dev/null -w "HTTP %{http_code}\\n" http://127.0.0.1:8787/api/health || echo "health endpoint not reachable yet"
                        echo "=== /api/integration/status (mode & credentials) ==="
                        curl -s http://127.0.0.1:8787/api/integration/status | head -c 400 || echo "integration status not reachable yet"
                        echo ""
                    '''
                }
            }
        }
    }

    post {
        success {
            echo "✅ 构建并部署成功！服务已启动。"
        }
        failure {
            echo "❌ 构建或部署失败，请检查 SSH 服务器上的 Jenkins 日志。"
        }
    }
}

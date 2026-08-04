pipeline {
    agent any

    environment {
        // 定义镜像名称和标签
        IMAGE_NAME = 'fusiongo-distribution-platform'
        IMAGE_TAG = 'latest'
        // 定义 Docker Compose 项目名称
        COMPOSE_PROJECT_NAME = 'fusiongo'
    }

    stages {
        stage('Checkout') {
            steps {
                // 拉取代码
                checkout scm
            }
        }

        stage('Deploy with Docker Compose') {
            steps {
                script {
                    echo "开始使用 Docker Compose 部署..."
                    
                    // 1. 停止并移除旧容器
                    sh "docker-compose -p ${COMPOSE_PROJECT_NAME} down || true"
                    
                    // 2. 重新构建并后台启动
                    sh "docker-compose -p ${COMPOSE_PROJECT_NAME} up -d --build"
                }
            }
        }
    }
    
    post {
        success {
            echo "✅ 构建并部署成功！服务已启动。"
        }
        failure {
            echo "❌ 构建或部署失败，请检查 Jenkins 日志。"
        }
    }
}
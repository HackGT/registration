#!/usr/bin/env bash
# HACKGPROJECT VERSION: c7f8a4124228d1b48a0420d042a4aea4ff52d480

set -euo pipefail
SOURCE_DIR=$(readlink -f "${BASH_SOURCE[0]}")
SOURCE_DIR=$(dirname "$SOURCE_DIR")
cd "${SOURCE_DIR}/.."
set -x

if ! hash docker &>/dev/null; then
    echo "Cannot find `docker`!" >&2
    exit 64
fi

docker=
if docker ps &>/dev/null; then
    docker=docker
else
    docker='sudo docker'
fi

remote=$(git remote -v | grep -Po 'HackGT/[a-zA-Z0-9-_\.]*' | head -1)
image_name=$(basename "${remote%.*}")

build_project_source() {
    if [[ -f Dockerfile.build ]]; then
        local build_image_name="$(basename $(pwd))-build"
        $docker build -f Dockerfile.build --rm -t "$build_image_name" .
        $docker run -w '/src' -v "$(pwd):/src" "$build_image_name"
    fi
}

test_project_source() {
    if [[ -f Dockerfile.test ]]; then
        local test_image_name="$(basename $(pwd))-test"
        $docker build -f Dockerfile.test --rm -t "$test_image_name" .
        $docker run -w '/src' -v "$(pwd):/src" "$test_image_name"
    fi
}

build_project_container() {
    $docker build -f Dockerfile --rm -t "$image_name" .
}

publish_project_container() {
    local git_rev=$(git rev-parse HEAD)
    local push_image_name="${DOCKER_ID_USER}/${image_name}"
    docker login -u="${DOCKER_ID_USER}" -p="${DOCKER_PASSWORD}"
    docker tag "$image_name" "$push_image_name":"$git_rev"
    docker push "$push_image_name"
    docker tag "$push_image_name":"$git_rev" "$push_image_name":latest
    docker push "$push_image_name"
}

trigger_biodomes_build() {
    body='{
    "request": {
    "branch":"master"
    } }'

    curl -s -X POST \
       -H "Content-Type: application/json" \
       -H "Accept: application/json" \
       -H "Travis-API-Version: 3" \
       -H "Authorization: token ${TRAVIS_TOKEN}" \
       -d "$body" \
       https://api.travis-ci.org/repo/HackGT%2Fbiodomes/requests
}


build_project_source
test_project_source
build_project_container

if [[ ${TRAVIS_BRANCH:-} = master && ${TRAVIS_PULL_REQUEST-} = false ]]; then
    publish_project_container
    trigger_biodomes_build
fi


## Build and run docker image locally

```
docker buildx build --platform linux/amd64 -t auuki:amd64 --load .
docker run -d -p 8080:80 --name auuki-test auuki
```

The app is now running in a container and would be accessible at http://localhost:8080

## Running on another machine

Build for the correct architecture e.g. linux/amd64 for WSL

```
docker buildx build --platform linux/amd64 -t auuki:amd64 --load .
docker save auuki:amd64 > auuki_amd64.tar
```

On the other machine:

```
docker load < auuki_amd64.tar
docker run -d -p 8080:80 auuki:amd64
```

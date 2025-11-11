# XRK-Yunzai v3.0.5

基于乐神版[云崽v3.0](https://gitee.com/le-niao/Yunzai-Bot) 与喵喵版[喵崽v3.1.3](https://gitee.com/yoimiya-kokomi/Miao-Yunzai) 还有时雨版[时雨崽3.1.3](https://gitee.com/TimeRainStarSky/Yunzai)

感谢我在编写过程中时雨佬等佬的帮助
感谢我在编写时萌新们的支持

## 使用方法

> 必要环境 Windows/Linux + Chrome/Chromium/Edge

> 必要环境 Node.js>18.14.0 + Redis>5.0.0

## XRK-Yunzai 后续计划

- 最快实现的就是pm2的启动方式（目前还没有实现，在查资料）{已经实现}
- 开源对接任务处理器（对接Mysql，微信公众号等） {已完成}
- 投入农业实践使用 (已完成)
- 将icqq等相关底层剥离，以方便类型扩展和开发
- 完善任务处理逻辑，类型变量等等定义更加规范化 {已完成}

### 克隆项目

```sh
# 使用Gitcode
git clone --depth=1 https://gitcode.com/Xrkseek/XRK-Yunzai.git
cd XRK-Yunzai 
# 使用Gitee
git clone --depth=1 https://gitee.com/xrkseek/XRK-Yunzai.git
cd XRK-Yunzai 
# 使用Github
git clone --depth=1 https://github.com/Xrkseek/XRK-Yunzai.git
cd XRK-Yunzai 
```

###  安装依赖<自动>

> 外网环境请修改的本地npm配置.npmrc,改完了之后再启动
> 国内环境直接运行即可
> 如果有没有安装上的依赖，可以下载向日葵插件发送#打依赖来安装

###  运行与指令相关（无需打依赖）

> 首次运行按提示输入登录
> 支持多开窗口登录，模仿类QQ平台类的处理方法，Bot多例运行，处理回复保持最大兼容性
> 与 Yunzai-Bot V3.0不同的是，icqq登录的配置文件储存在 data/bots/<QQ号> 文件夹内，
> 服务器登录相关插件在config/server_config内，方便了用户的迁移

启动启动脚本(这句话是不是很绕？嘻嘻嘻)
```sh
node app # 启动
```

### 葵崽重要特性

[点进来吧](./stdin.md)

<hr>

## 致谢(永远不变)

|                           Nickname                            |       name       |   Contribution   |
|:-------------------------------------------------------------:|------------------|------------------|
|      [Yunzai v3.0](https://gitee.com/le-niao/Yunzai-Bot)      | 乐神的Yunzai-Bot V3 | 元老级项目 |
|      [Miao-Yunzai v3.1.3](https://gitee.com/yoimiya-kokomi/Miao-Yunzai)      | 喵喵的Miao-Yunzai | 项目基础，提供了优化方向和原神功能适配 |
|      [TRSS-Yunzai v3.1.3](https://gitee.com/TimeRainStarSky/Yunzai)      | 时雨的Yunzai | 为葵崽底层设计提供了不可磨灭的贡献，时雨崽是当之无愧的node项目的艺术品 |
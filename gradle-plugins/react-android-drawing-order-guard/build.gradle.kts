plugins {
  `java-gradle-plugin`
}

group = "com.garamin.build"
version = "1.0.0"

repositories {
  google()
  mavenCentral()
}

dependencies {
  implementation(gradleApi())
  compileOnly("com.android.tools.build:gradle-api:8.11.0")
  implementation("org.ow2.asm:asm:9.7.1")
}

java {
  toolchain {
    languageVersion = JavaLanguageVersion.of(17)
  }
}

gradlePlugin {
  plugins {
    register("reactAndroidDrawingOrderGuard") {
      id = "com.garamin.react-android-drawing-order-guard"
      implementationClass =
        "com.garamin.build.ReactAndroidDrawingOrderGuardPlugin"
    }
  }
}

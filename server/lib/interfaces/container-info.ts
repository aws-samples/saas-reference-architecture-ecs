export interface ContainerInfo {
  name: string
  image: string
  memoryLimitMiB: number
  cpu: number
  containerPort: number
  sortKey?: string
  tableName: string
  policy: string
}
